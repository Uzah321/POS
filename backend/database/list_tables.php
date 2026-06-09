$db = new PDO(\"sqlite:database/bottlestore.sqlite\"); $stmt = $db->query(\"SELECT name FROM sqlite_master WHERE type=table ORDER BY name\"); while($r = $stmt->fetch()) echo $r[name].PHP_EOL;
