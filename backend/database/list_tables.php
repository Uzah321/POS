<?php

$host = getenv('DB_HOST') ?: '127.0.0.1';
$port = getenv('DB_PORT') ?: '3307';
$database = getenv('DB_DATABASE') ?: 'core_pos';
$username = getenv('DB_USERNAME') ?: 'core_pos';
$password = getenv('DB_PASSWORD') ?: 'CorePosDb@2026';

$db = new PDO("mysql:host=$host;port=$port;dbname=$database;charset=utf8mb4", $username, $password);
$stmt = $db->query('SHOW TABLES');

while ($row = $stmt->fetch(PDO::FETCH_NUM)) {
    echo $row[0] . PHP_EOL;
}
