<# : batch portion
@echo off
rem ---------------------------------------------------------------------------
rem Core Bridge - lets the online Core POS (in Chrome/Edge on this computer)
rem use the shop's hardware: read an IP weighing scale on the shop's network,
rem and list and print to the printers Windows has installed here. A web page
rem can't do either by itself, and the online server can't see inside the
rem shop, so this small program relays for it: the till page talks to it on
rem this computer only (127.0.0.1), it talks to the scale or the printer.
rem
rem Double-click to start; leave the window open (minimised is fine). To start
rem it with Windows, put this file in the Startup folder (Win+R, shell:startup).
rem
rem This file is a batch launcher wrapped around a PowerShell script, which
rem Windows runs as-is - nothing is installed.
rem ---------------------------------------------------------------------------
title Core Bridge
set "CORE_BRIDGE_SELF=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-Expression ([System.IO.File]::ReadAllText($env:CORE_BRIDGE_SELF))"
echo.
echo The Core Bridge has stopped. Press any key to close this window.
pause >nul
goto :eof
#>

$ErrorActionPreference = 'Stop'

# Filled in when the file is downloaded from the Hardware page: the bridge
# only serves pages from that web address, on this port.
$BridgePort = __CORE_BRIDGE_PORT__
$AllowedOrigin = '__CORE_ALLOWED_ORIGIN__'

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

// One WebSocket per request, from the browser:
// - GET /connect?host=&port= opens a TCP connection to the scale and relays
//   whatever it sends as {"type":"data","chunk":"..."} messages;
//   {"type":"open"} once connected. Nothing the page sends goes to the scale.
// - GET /printers answers {"type":"printers","printers":[...]}: the printers
//   Windows has installed on this computer.
// - GET /print?printer= takes one binary message, the job in the printer's
//   own language (ESC/POS), and hands it to that printer's queue as-is;
//   {"type":"printed"} once it's there.
// Any of them answers {"type":"error","message":"..."} when it can't. GET
// /ping answers {"type":"hello"} so the page can tell the bridge is running.
public static class CoreBridge
{
    const string WsGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    static string allowedOrigin;

    public static void Run(int port, string origin)
    {
        allowedOrigin = origin.TrimEnd('/');
        TcpListener listener = new TcpListener(IPAddress.Loopback, port);
        try { listener.Start(); }
        catch (SocketException)
        {
            Console.WriteLine("Port " + port + " is already in use - the Core Bridge (or an older Core Scale Bridge) is");
            Console.WriteLine("probably already running. Close that window, then start this one again.");
            return;
        }
        Log("Core Bridge is running for " + allowedOrigin + " (scales and printers)");
        Log("Leave this window open (minimised is fine) while the till is in use.");
        while (true)
        {
            TcpClient client = listener.AcceptTcpClient();
            Thread t = new Thread(() => HandleClient(client));
            t.IsBackground = true;
            t.Start();
        }
    }

    static void HandleClient(TcpClient client)
    {
        NetworkStream page = null;
        TcpClient scale = null;
        Thread watcher = null;
        bool upgraded = false;
        try
        {
            client.NoDelay = true;
            page = client.GetStream();
            page.ReadTimeout = 5000;
            Dictionary<string, string> headers;
            string path = ReadRequest(page, out headers);
            if (path == null) return;

            string key;
            if (!headers.TryGetValue("sec-websocket-key", out key))
            {
                WriteHttp(page, "Core Scale Bridge is running.");
                return;
            }
            string accept = Convert.ToBase64String(SHA1.Create().ComputeHash(Encoding.ASCII.GetBytes(key.Trim() + WsGuid)));
            byte[] handshake = Encoding.ASCII.GetBytes(
                "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n");
            page.Write(handshake, 0, handshake.Length);
            page.ReadTimeout = Timeout.Infinite;
            upgraded = true;

            // Browsers always send Origin, so a page from any other website is
            // turned away; a request without one isn't from a web page at all.
            string origin;
            headers.TryGetValue("origin", out origin);
            bool allowed = origin == null || origin.TrimEnd('/').Equals(allowedOrigin, StringComparison.OrdinalIgnoreCase);

            string route = path;
            string query = "";
            int q = path.IndexOf('?');
            if (q >= 0) { route = path.Substring(0, q); query = path.Substring(q + 1); }

            if (route == "/ping")
            {
                SendText(page, "{\"type\":\"hello\",\"version\":2,\"printers\":true,\"allowed\":" + (allowed ? "true" : "false") + "}");
                return;
            }
            if (route != "/connect" && route != "/printers" && route != "/print") { SendError(page, "Unknown request."); return; }
            if (!allowed)
            {
                SendError(page, "This Core Bridge was downloaded for " + allowedOrigin + ". Download it again from the Hardware page of the site you're using.");
                return;
            }

            Dictionary<string, string> args = ParseQuery(query);
            if (route == "/printers")
            {
                try { SendText(page, PrinterList()); }
                catch (Exception e) { SendError(page, "Couldn't list this computer's printers: " + e.Message); }
                return;
            }
            if (route == "/print") { HandlePrint(page, args); return; }

            string host;
            string portText;
            int port;
            if (!args.TryGetValue("host", out host) || !args.TryGetValue("port", out portText)
                || !int.TryParse(portText, out port) || port < 1 || port > 65535)
            {
                SendError(page, "Missing scale address or port.");
                return;
            }
            IPAddress address = ResolveLocal(host);
            if (address == null)
            {
                SendError(page, host + " isn't an address on this shop's network - the Core Bridge only connects to local devices.");
                return;
            }

            scale = new TcpClient(address.AddressFamily);
            IAsyncResult pending = scale.BeginConnect(address, port, null, null);
            if (!pending.AsyncWaitHandle.WaitOne(5000)) { SendError(page, "Connection timed out"); return; }
            try { scale.EndConnect(pending); }
            catch (SocketException e)
            {
                SendError(page, "connect " + ErrorName(e) + " " + host + ":" + port);
                return;
            }
            scale.NoDelay = true;
            Log("Connected to " + host + ":" + port);
            if (!SendText(page, "{\"type\":\"open\"}")) return;

            // The page closing its end (or pinging) arrives on its own thread;
            // closing the scale socket from there ends the relay loop below.
            NetworkStream pageStream = page;
            TcpClient scaleClient = scale;
            watcher = new Thread(() => WatchPage(pageStream, scaleClient));
            watcher.IsBackground = true;
            watcher.Start();

            NetworkStream scaleStream = scale.GetStream();
            byte[] buffer = new byte[4096];
            while (true)
            {
                int n;
                try { n = scaleStream.Read(buffer, 0, buffer.Length); }
                catch { n = 0; }
                if (n <= 0) break;
                string chunk = Encoding.UTF8.GetString(buffer, 0, n);
                if (!SendText(page, "{\"type\":\"data\",\"chunk\":" + JsonString(chunk) + "}")) break;
            }
            Log("Disconnected from " + host + ":" + port);
        }
        catch (Exception e)
        {
            Log("Error: " + e.Message);
        }
        finally
        {
            if (scale != null) { try { scale.Close(); } catch { } }
            if (upgraded)
            {
                SendFrame(page, 8, new byte[] { 0x03, 0xE8 });
                try { client.Client.Shutdown(SocketShutdown.Send); } catch { }
                // Let the page read our last message and close its side before
                // the socket goes - closing with its reply unread would reset
                // the connection and could lose that message.
                if (watcher != null) watcher.Join(1000);
                else Drain(page);
            }
            try { client.Close(); } catch { }
        }
    }

    static void WatchPage(NetworkStream page, TcpClient scale)
    {
        try
        {
            while (true)
            {
                int b0 = page.ReadByte();
                int b1 = page.ReadByte();
                if (b0 < 0 || b1 < 0) break;
                int opcode = b0 & 0x0F;
                bool masked = (b1 & 0x80) != 0;
                long length = b1 & 0x7F;
                if (length == 126) { byte[] l = ReadExact(page, 2); length = (l[0] << 8) | l[1]; }
                else if (length == 127) { byte[] l = ReadExact(page, 8); length = 0; for (int i = 0; i < 8; i++) length = (length << 8) | l[i]; }
                if (length > 65536) break;
                byte[] mask = masked ? ReadExact(page, 4) : null;
                byte[] payload = ReadExact(page, (int)length);
                if (masked) for (int i = 0; i < payload.Length; i++) payload[i] ^= mask[i % 4];
                if (opcode == 8) break;
                if (opcode == 9) SendFrame(page, 10, payload);
            }
        }
        catch { }
        try { scale.Close(); } catch { }
    }

    // ---- Printers -----------------------------------------------------------

    static void HandlePrint(NetworkStream page, Dictionary<string, string> args)
    {
        string printer;
        if (!args.TryGetValue("printer", out printer) || printer.Trim().Length == 0)
        {
            SendError(page, "No printer named.");
            return;
        }
        byte[] job;
        try
        {
            page.ReadTimeout = 15000;
            job = ReadMessage(page, 4 * 1024 * 1024);
        }
        catch { job = null; }
        if (job == null || job.Length == 0)
        {
            SendError(page, "The print job didn't arrive.");
            return;
        }
        string error;
        try { error = RawPrint(printer, job); }
        catch (Exception e) { error = e.Message; }
        if (error != null)
        {
            Log("Couldn't print on " + printer + ": " + error);
            SendError(page, error);
            return;
        }
        Log("Printed on " + printer + " (" + job.Length + " bytes)");
        SendText(page, "{\"type\":\"printed\"}");
    }

    // One whole message from the page, joined from its frames - null if the
    // page closes first or sends more than `limit` bytes.
    static byte[] ReadMessage(NetworkStream page, int limit)
    {
        MemoryStream message = new MemoryStream();
        while (true)
        {
            int b0 = page.ReadByte();
            int b1 = page.ReadByte();
            if (b0 < 0 || b1 < 0) return null;
            bool fin = (b0 & 0x80) != 0;
            int opcode = b0 & 0x0F;
            bool masked = (b1 & 0x80) != 0;
            long length = b1 & 0x7F;
            if (length == 126) { byte[] l = ReadExact(page, 2); length = (l[0] << 8) | l[1]; }
            else if (length == 127) { byte[] l = ReadExact(page, 8); length = 0; for (int i = 0; i < 8; i++) length = (length << 8) | l[i]; }
            if (length < 0 || message.Length + length > limit) return null;
            byte[] mask = masked ? ReadExact(page, 4) : null;
            byte[] payload = ReadExact(page, (int)length);
            if (masked) for (int i = 0; i < payload.Length; i++) payload[i] ^= mask[i % 4];
            if (opcode == 8) return null;
            if (opcode == 9) { SendFrame(page, 10, payload); continue; }
            if (opcode == 10) continue;
            message.Write(payload, 0, payload.Length);
            if (fin) return message.ToArray();
        }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct PRINTER_INFO_2
    {
        public string pServerName;
        public string pPrinterName;
        public string pShareName;
        public string pPortName;
        public string pDriverName;
        public string pComment;
        public string pLocation;
        public IntPtr pDevMode;
        public string pSepFile;
        public string pPrintProcessor;
        public string pDatatype;
        public string pParameters;
        public IntPtr pSecurityDescriptor;
        public uint Attributes;
        public uint Priority;
        public uint DefaultPriority;
        public uint StartTime;
        public uint UntilTime;
        public uint Status;
        public uint cJobs;
        public uint AveragePPM;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    class DOC_INFO_1
    {
        public string pDocName;
        public string pOutputFile;
        public string pDatatype;
    }

    [DllImport("winspool.drv", EntryPoint = "EnumPrintersW", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    static extern bool EnumPrinters(int flags, string name, int level, IntPtr buffer, int size, out int needed, out int returned);
    [DllImport("winspool.drv", EntryPoint = "GetDefaultPrinterW", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    static extern bool GetDefaultPrinter(StringBuilder buffer, ref int size);
    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool ClosePrinter(IntPtr handle);
    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    static extern int StartDocPrinter(IntPtr handle, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOC_INFO_1 info);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool EndDocPrinter(IntPtr handle);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool StartPagePrinter(IntPtr handle);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool EndPagePrinter(IntPtr handle);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool WritePrinter(IntPtr handle, byte[] data, int count, out int written);

    // This computer's printers and the ones it's connected to on the network.
    static List<PRINTER_INFO_2> InstalledPrinters()
    {
        const int Local = 2, Connections = 4;
        List<PRINTER_INFO_2> printers = new List<PRINTER_INFO_2>();
        int needed, returned;
        EnumPrinters(Local | Connections, null, 2, IntPtr.Zero, 0, out needed, out returned);
        if (needed <= 0) return printers;
        IntPtr buffer = Marshal.AllocHGlobal(needed);
        try
        {
            if (!EnumPrinters(Local | Connections, null, 2, buffer, needed, out needed, out returned))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            int size = Marshal.SizeOf(typeof(PRINTER_INFO_2));
            for (int i = 0; i < returned; i++)
                printers.Add((PRINTER_INFO_2)Marshal.PtrToStructure(new IntPtr(buffer.ToInt64() + (long)i * size), typeof(PRINTER_INFO_2)));
        }
        finally { Marshal.FreeHGlobal(buffer); }
        return printers;
    }

    static string PrinterList()
    {
        StringBuilder defaultBuffer = new StringBuilder(1024);
        int defaultSize = defaultBuffer.Capacity;
        string defaultName = GetDefaultPrinter(defaultBuffer, ref defaultSize) ? defaultBuffer.ToString() : "";
        StringBuilder json = new StringBuilder("{\"type\":\"printers\",\"printers\":[");
        bool first = true;
        foreach (PRINTER_INFO_2 p in InstalledPrinters())
        {
            // "Use printer offline", or Windows reporting it offline.
            bool offline = (p.Attributes & 0x400) != 0 || (p.Status & 0x80) != 0;
            if (!first) json.Append(',');
            first = false;
            json.Append("{\"name\":").Append(JsonString(p.pPrinterName ?? ""))
                .Append(",\"port\":").Append(JsonString(p.pPortName ?? ""))
                .Append(",\"isDefault\":").Append(p.pPrinterName == defaultName ? "true" : "false")
                .Append(",\"offline\":").Append(offline ? "true" : "false")
                .Append('}');
        }
        return json.Append("]}").ToString();
    }

    // Hands the job to the printer's queue untouched (RAW) - null once it's
    // there, else why not. Only to a printer Windows has installed, so a page
    // can't name some other machine's share.
    static string RawPrint(string printer, byte[] job)
    {
        bool installed = false;
        foreach (PRINTER_INFO_2 p in InstalledPrinters())
        {
            if (string.Equals(p.pPrinterName, printer, StringComparison.OrdinalIgnoreCase)) { installed = true; break; }
        }
        if (!installed) return "not installed on this computer - choose the printer again in Hardware";

        IntPtr handle;
        if (!OpenPrinter(printer, out handle, IntPtr.Zero)) return Win32Message();
        try
        {
            DOC_INFO_1 doc = new DOC_INFO_1();
            doc.pDocName = "Core POS";
            doc.pDatatype = "RAW";
            if (StartDocPrinter(handle, 1, doc) == 0) return Win32Message();
            try
            {
                if (!StartPagePrinter(handle)) return Win32Message();
                int written;
                bool ok = WritePrinter(handle, job, job.Length, out written);
                string error = !ok ? Win32Message() : written != job.Length ? "The printer took only part of the job." : null;
                EndPagePrinter(handle);
                return error;
            }
            finally { EndDocPrinter(handle); }
        }
        finally { ClosePrinter(handle); }
    }

    static string Win32Message()
    {
        return new Win32Exception(Marshal.GetLastWin32Error()).Message;
    }

    static void Drain(NetworkStream page)
    {
        try
        {
            page.ReadTimeout = 1000;
            byte[] sink = new byte[1024];
            while (page.Read(sink, 0, sink.Length) > 0) { }
        }
        catch { }
    }

    static byte[] ReadExact(NetworkStream s, int count)
    {
        byte[] data = new byte[count];
        int read = 0;
        while (read < count)
        {
            int n = s.Read(data, read, count - read);
            if (n <= 0) throw new Exception("closed");
            read += n;
        }
        return data;
    }

    static string ReadRequest(NetworkStream s, out Dictionary<string, string> headers)
    {
        headers = new Dictionary<string, string>();
        StringBuilder sb = new StringBuilder();
        while (true)
        {
            if (sb.Length > 8192) return null;
            int b = s.ReadByte();
            if (b < 0) return null;
            sb.Append((char)b);
            int n = sb.Length;
            if (n >= 4 && sb[n - 4] == '\r' && sb[n - 3] == '\n' && sb[n - 2] == '\r' && sb[n - 1] == '\n') break;
        }
        string[] lines = sb.ToString().Split(new string[] { "\r\n" }, StringSplitOptions.None);
        string[] first = lines[0].Split(' ');
        if (first.Length < 2 || first[0] != "GET") return null;
        for (int i = 1; i < lines.Length; i++)
        {
            int c = lines[i].IndexOf(':');
            if (c > 0) headers[lines[i].Substring(0, c).Trim().ToLowerInvariant()] = lines[i].Substring(c + 1).Trim();
        }
        return first[1];
    }

    static void WriteHttp(NetworkStream s, string body)
    {
        byte[] b = Encoding.UTF8.GetBytes(body);
        byte[] h = Encoding.ASCII.GetBytes(
            "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\nContent-Length: " + b.Length + "\r\n\r\n");
        s.Write(h, 0, h.Length);
        s.Write(b, 0, b.Length);
    }

    static Dictionary<string, string> ParseQuery(string query)
    {
        Dictionary<string, string> result = new Dictionary<string, string>();
        foreach (string part in query.Split('&'))
        {
            int eq = part.IndexOf('=');
            if (eq <= 0) continue;
            result[Uri.UnescapeDataString(part.Substring(0, eq).Replace('+', ' '))] = Uri.UnescapeDataString(part.Substring(eq + 1).Replace('+', ' '));
        }
        return result;
    }

    // Only addresses inside the shop's network (or this computer) - so a page
    // can't use the bridge to reach anything out on the internet.
    static IPAddress ResolveLocal(string host)
    {
        IPAddress[] candidates;
        IPAddress literal;
        if (IPAddress.TryParse(host.Trim('[', ']'), out literal)) candidates = new IPAddress[] { literal };
        else
        {
            try { candidates = Dns.GetHostAddresses(host); }
            catch { return null; }
        }
        foreach (IPAddress a in candidates) if (IsLocal(a)) return a;
        return null;
    }

    static bool IsLocal(IPAddress a)
    {
        if (IPAddress.IsLoopback(a)) return true;
        byte[] b = a.GetAddressBytes();
        if (a.AddressFamily == AddressFamily.InterNetwork)
            return b[0] == 10 || (b[0] == 172 && b[1] >= 16 && b[1] <= 31) || (b[0] == 192 && b[1] == 168) || (b[0] == 169 && b[1] == 254);
        if (a.AddressFamily == AddressFamily.InterNetworkV6)
            return a.IsIPv6LinkLocal || a.IsIPv6SiteLocal || (b[0] & 0xFE) == 0xFC;
        return false;
    }

    // Same wording as the desktop app's errors, so the page reads both alike.
    static string ErrorName(SocketException e)
    {
        switch (e.SocketErrorCode)
        {
            case SocketError.ConnectionRefused: return "ECONNREFUSED";
            case SocketError.HostUnreachable: return "EHOSTUNREACH";
            case SocketError.NetworkUnreachable: return "ENETUNREACH";
            case SocketError.TimedOut: return "ETIMEDOUT";
            default: return e.SocketErrorCode.ToString();
        }
    }

    static bool SendText(NetworkStream s, string text)
    {
        return SendFrame(s, 1, Encoding.UTF8.GetBytes(text));
    }

    static void SendError(NetworkStream s, string message)
    {
        SendText(s, "{\"type\":\"error\",\"message\":" + JsonString(message) + "}");
    }

    static bool SendFrame(NetworkStream s, int opcode, byte[] payload)
    {
        try
        {
            byte[] header;
            if (payload.Length < 126) header = new byte[] { (byte)(0x80 | opcode), (byte)payload.Length };
            else if (payload.Length <= 0xFFFF) header = new byte[] { (byte)(0x80 | opcode), 126, (byte)(payload.Length >> 8), (byte)payload.Length };
            else
            {
                header = new byte[10];
                header[0] = (byte)(0x80 | opcode);
                header[1] = 127;
                long l = payload.Length;
                for (int i = 9; i >= 2; i--) { header[i] = (byte)(l & 0xFF); l >>= 8; }
            }
            lock (s)
            {
                s.Write(header, 0, header.Length);
                s.Write(payload, 0, payload.Length);
            }
            return true;
        }
        catch { return false; }
    }

    static string JsonString(string text)
    {
        StringBuilder sb = new StringBuilder("\"");
        foreach (char c in text)
        {
            if (c == '"') sb.Append("\\\"");
            else if (c == '\\') sb.Append("\\\\");
            else if (c < 0x20 || c == (char)0x2028 || c == (char)0x2029) sb.Append("\\u").Append(((int)c).ToString("x4"));
            else sb.Append(c);
        }
        return sb.Append('"').ToString();
    }

    static void Log(string message)
    {
        Console.WriteLine(DateTime.Now.ToString("HH:mm:ss") + "  " + message);
    }
}
'@

[CoreBridge]::Run($BridgePort, $AllowedOrigin)
