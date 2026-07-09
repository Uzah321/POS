<?php
namespace App\Http\Controllers\Api;
use App\Http\Controllers\Controller;
use Illuminate\Support\Facades\Storage;

class BackupController extends Controller {

    public function index() {
        $files  = Storage::disk('local')->files('backups');
        $result = [];
        foreach ($files as $f) {
            $result[] = [
                'name'       => basename($f),
                'size'       => Storage::disk('local')->size($f),
                'created_at' => Storage::disk('local')->lastModified($f),
            ];
        }
        usort($result, fn($a, $b) => $b['created_at'] - $a['created_at']);
        return response()->json(['data' => $result]);
    }

    public function create() {
        $name = 'backup_' . date('Ymd_His') . '.sql';
        $dir  = storage_path('app/backups');
        if (!is_dir($dir)) mkdir($dir, 0755, true);
        $outPath = $dir . DIRECTORY_SEPARATOR . $name;

        $connection = env('DB_CONNECTION', 'mariadb');
        $host = env('DB_HOST', '127.0.0.1');
        $port = env('DB_PORT', $connection === 'pgsql' ? '5432' : '3307');
        $db   = env('DB_DATABASE', 'core_pos');
        $user = env('DB_USERNAME', 'core_pos');
        $pass = env('DB_PASSWORD', 'CorePosDb@2026');

        if (in_array($connection, ['mysql', 'mariadb'], true)) {
            $dump = $this->findMysqlDump();
            if (!$dump) {
                return response()->json(['message' => 'mysqldump not found. Ensure MariaDB is installed.'], 500);
            }

            $cmd = sprintf(
                '%s --protocol=tcp --host=%s --port=%s --user=%s --password=%s --single-transaction --routines --triggers --databases %s > %s 2>&1',
                $dump,
                escapeshellarg($host),
                escapeshellarg((string) $port),
                escapeshellarg($user),
                escapeshellarg($pass),
                escapeshellarg($db),
                escapeshellarg($outPath)
            );
            exec($cmd, $output, $code);
        } else {
            $pgDump = $this->findPgDump();
            if (!$pgDump) {
                return response()->json(['message' => 'pg_dump not found. Ensure PostgreSQL is installed.'], 500);
            }

            $pgpassFile = storage_path('app/pgpass_tmp.conf');
            file_put_contents($pgpassFile, "$host:$port:$db:$user:$pass\n");
            chmod($pgpassFile, 0600);
            putenv("PGPASSFILE=$pgpassFile");
            putenv("PGPASSWORD=$pass");

            $quotedOut = escapeshellarg($outPath);
            $cmd = "$pgDump -h $host -p $port -U $user -F p --no-password -f $quotedOut $db 2>&1";
            exec($cmd, $output, $code);

            @unlink($pgpassFile);
            putenv('PGPASSFILE=');
        }

        if ($code !== 0 || !file_exists($outPath) || filesize($outPath) === 0) {
            return response()->json([
                'message' => 'pg_dump failed: ' . implode(' ', $output),
            ], 500);
        }

        return response()->json(['message' => 'Backup created', 'file' => $name], 201);
    }

    public function download(string $file) {
        // Prevent directory traversal
        $file = basename($file);
        $path = storage_path('app/backups/' . $file);
        if (!file_exists($path)) {
            return response()->json(['message' => 'File not found'], 404);
        }
        return response()->download($path);
    }

    private function findPgDump(): ?string {
        // 1. Try PATH first (Linux / macOS / Windows with PG in PATH)
        $which = PHP_OS_FAMILY === 'Windows' ? 'where pg_dump 2>nul' : 'which pg_dump 2>/dev/null';
        exec($which, $out, $code);
        if ($code === 0 && !empty($out[0])) {
            return '"' . trim($out[0]) . '"';
        }

        // 2. Windows: scan Program Files for any installed PostgreSQL version
        if (PHP_OS_FAMILY === 'Windows') {
            $pattern = 'C:\\Program Files\\PostgreSQL\\*\\bin\\pg_dump.exe';
            $matches = glob($pattern);
            if ($matches) {
                rsort($matches); // newest version first
                return '"' . $matches[0] . '"';
            }
        }

        // 3. Common Linux paths
        foreach (['/usr/bin/pg_dump', '/usr/local/bin/pg_dump'] as $p) {
            if (file_exists($p)) return $p;
        }

        return null;
    }

    private function findMysqlDump(): ?string {
        $configured = env('DB_DUMP_PATH');
        if ($configured && file_exists($configured)) {
            return '"' . $configured . '"';
        }

        $which = PHP_OS_FAMILY === 'Windows' ? 'where mysqldump 2>nul' : 'which mysqldump 2>/dev/null';
        exec($which, $out, $code);
        if ($code === 0 && !empty($out[0])) {
            return '"' . trim($out[0]) . '"';
        }

        if (PHP_OS_FAMILY === 'Windows') {
            foreach ([
                'C:\\POS\\MariaDB\\bin\\mysqldump.exe',
                'C:\\Program Files\\MariaDB*\\bin\\mysqldump.exe',
            ] as $pattern) {
                $matches = glob($pattern);
                if ($matches) {
                    rsort($matches);
                    return '"' . $matches[0] . '"';
                }
            }
        }

        foreach (['/usr/bin/mysqldump', '/usr/local/bin/mysqldump'] as $path) {
            if (file_exists($path)) return $path;
        }

        return null;
    }
}
