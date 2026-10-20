// The parts of qz-tray.js (QZ Tray's browser library, which ships no types) this app uses.
declare module 'qz-tray' {
  type Resolver<T> = (resolve: (value: T) => void, reject: (reason?: unknown) => void) => void;

  interface PrinterDetail {
    name: string;
    driver?: string;
    connection?: string;
    default?: boolean;
  }

  interface PrintData {
    type: 'raw' | 'pixel';
    format: 'command' | 'html';
    flavor: 'base64' | 'plain';
    data: string | Uint8Array;
  }

  const qz: {
    websocket: {
      isActive(): boolean;
      connect(options?: { retries?: number; delay?: number; keepAlive?: number }): Promise<void>;
      disconnect(): Promise<void>;
      setClosedCallbacks(callback: () => void): void;
    };
    security: {
      setCertificatePromise(resolver: Resolver<string>): void;
      setSignatureAlgorithm(algorithm: 'SHA1' | 'SHA256' | 'SHA512'): void;
      setSignaturePromise(factory: (toSign: string) => Resolver<string>): void;
    };
    printers: {
      find(query?: string): Promise<string | string[]>;
      getDefault(): Promise<string>;
      details(): Promise<PrinterDetail[]>;
    };
    configs: {
      create(printer: string, options?: Record<string, unknown>): unknown;
    };
    print(config: unknown, data: PrintData[]): Promise<void>;
    api: {
      getVersion(): Promise<string>;
    };
  };
  export default qz;
}
