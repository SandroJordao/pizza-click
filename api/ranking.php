<?php
/**
 * Ranking do Pizza Click.
 *
 * GET  → { ok, top }                         10 melhores
 * POST → { ok, top, position, entry, improved } grava a pontuação
 *        corpo JSON: { name, score, pizzas, level, time }
 *
 * Os dados ficam em data/ranking.json (bloqueado para acesso direto
 * pelo data/.htaccess). Cada nome aparece uma vez, com a melhor pontuação.
 *
 * @author Sandro Jordão.
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

date_default_timezone_set('America/Sao_Paulo');

define('RANKING_FILE', dirname(__DIR__) . '/data/ranking.json');
define('TOP', 10);
define('MAX_ENTRIES', 100);
define('MIN_INTERVAL', 10); // segundos entre envios do mesmo IP

// Precisa bater com as regras do js/main.js.
define('PIZZAS_PER_LEVEL', 2);
define('MIN_SECONDS_PER_PIZZA', 2);

function respond($data, $code = 200)
{
	http_response_code($code);

	echo json_encode($data, JSON_UNESCAPED_UNICODE);

	exit;
}

function fail($error, $code)
{
	respond(array('ok' => false, 'error' => $error), $code);
}

function open_ranking()
{
	$dir = dirname(RANKING_FILE);

	if ( ! is_dir($dir) && ! @mkdir($dir, 0775, true))
	{
		fail('Não foi possível gravar o ranking.', 500);
	}

	$fp = @fopen(RANKING_FILE, 'c+');

	if ( ! $fp)
	{
		fail('Não foi possível gravar o ranking.', 500);
	}

	return $fp;
}

function read_ranking($fp)
{
	rewind($fp);

	$data = json_decode((string) stream_get_contents($fp), true);

	if ( ! is_array($data)) $data = array();

	return $data + array('entries' => array(), 'ips' => array());
}

function write_ranking($fp, $data)
{
	ftruncate($fp, 0);
	rewind($fp);
	fwrite($fp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
	fflush($fp);
}

function public_entry($entry)
{
	return array(
		'name' => $entry['name'],
		'score' => $entry['score'],
		'pizzas' => $entry['pizzas'],
		'level' => $entry['level'],
		'time' => $entry['time'],
		'date' => $entry['date']
	);
}

function top_entries($entries)
{
	return array_map('public_entry', array_slice($entries, 0, TOP));
}

function int_param($input, $key, $min, $max)
{
	$value = isset($input[$key]) ? filter_var($input[$key], FILTER_VALIDATE_INT) : false;

	if ($value === false || $value < $min || $value > $max)
	{
		fail('Dados da partida inválidos.', 422);
	}

	return $value;
}

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET')
{
	$fp = open_ranking();

	flock($fp, LOCK_SH);
	$data = read_ranking($fp);
	flock($fp, LOCK_UN);
	fclose($fp);

	respond(array('ok' => true, 'top' => top_entries($data['entries'])));
}

if ($method !== 'POST')
{
	fail('Método não permitido.', 405);
}

$input = json_decode(file_get_contents('php://input'), true);

if ( ! is_array($input))
{
	fail('Requisição inválida.', 400);
}

// Nome: letras (com acento), números, espaço, ponto, hífen e underline.
$name = isset($input['name']) ? trim(preg_replace('/\s+/u', ' ', (string) $input['name'])) : '';

if ( ! preg_match('/^[\p{L}\p{N} ._\-]{2,16}$/u', $name))
{
	fail('Use de 2 a 16 letras ou números no nome.', 422);
}

$score = int_param($input, 'score', 1, 1000000);
$pizzas = int_param($input, 'pizzas', 1, 100000);
$level = int_param($input, 'level', 1, 100000);
$time = int_param($input, 'time', 1, 86400);

// Confere se a partida é possível: o combo máximo é 1 + 2 + ... + pizzas,
// a fase depende das pizzas e cada pizza leva alguns segundos para montar.
if ($score > $pizzas * ($pizzas + 1) / 2
	|| $level !== 1 + intdiv($pizzas, PIZZAS_PER_LEVEL)
	|| $time < $pizzas * MIN_SECONDS_PER_PIZZA)
{
	fail('Dados da partida inválidos.', 422);
}

$fp = open_ranking();

flock($fp, LOCK_EX);

$data = read_ranking($fp);
$now = time();

// Limita envios repetidos do mesmo IP (guardado só como hash).
$ip = hash('sha256', isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '');

foreach ($data['ips'] as $hash => $last)
{
	if ($now - $last > 3600) unset($data['ips'][$hash]);
}

if (isset($data['ips'][$ip]) && $now - $data['ips'][$ip] < MIN_INTERVAL)
{
	flock($fp, LOCK_UN);
	fclose($fp);

	fail('Calma, pizzaiolo! Espere alguns segundos e tente de novo.', 429);
}

$data['ips'][$ip] = $now;

// Cada nome aparece uma vez: só substitui se a pontuação nova for maior.
$key = mb_strtolower($name, 'UTF-8');
$index = null;

foreach ($data['entries'] as $i => $entry)
{
	if (mb_strtolower($entry['name'], 'UTF-8') === $key) { $index = $i; break; }
}

$entry = array(
	'name' => $name,
	'score' => $score,
	'pizzas' => $pizzas,
	'level' => $level,
	'time' => $time,
	'date' => date('c', $now)
);

$improved = $index === null || $score > $data['entries'][$index]['score'];

if ($index === null)
{
	$data['entries'][] = $entry;
}
else if ($improved)
{
	$data['entries'][$index] = $entry;
}

// Maior pontuação primeiro; no empate, quem chegou antes.
usort($data['entries'], function ($a, $b) {
	return $b['score'] - $a['score'] ?: strcmp($a['date'], $b['date']);
});

$data['entries'] = array_slice($data['entries'], 0, MAX_ENTRIES);

$position = null;

foreach ($data['entries'] as $i => $saved)
{
	if (mb_strtolower($saved['name'], 'UTF-8') === $key)
	{
		$position = $i + 1;
		$entry = $saved;
		break;
	}
}

write_ranking($fp, $data);

flock($fp, LOCK_UN);
fclose($fp);

respond(array(
	'ok' => true,
	'top' => top_entries($data['entries']),
	'position' => $position,
	'entry' => $position ? public_entry($entry) : null,
	'improved' => $improved
));
