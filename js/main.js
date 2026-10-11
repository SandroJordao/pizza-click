/**
 * JS Document.
 * @author Sandro Jordão.
**/

(function () {
	'use strict'

	var SLICES = 7
	var PIZZAS = 6
	var LIVES = 3

	// Tempo para encaixar cada fatia: começa em 10s e diminui a cada nível.
	var BASE_TIME = 10000
	var MIN_TIME = 3000
	var TIME_STEP = 700
	var PIZZAS_PER_LEVEL = 2
	var WARN_TIME = 3000

	var FLY_DURATION = 300
	var TIMEOUT_DELAY = 800

	var STORAGE_RECORD = 'pizza.record'
	var STORAGE_MUTED = 'pizza.muted'
	var STORAGE_NAME = 'pizza.name'

	var RANKING_URL = 'api/ranking.php'

	var el = {}

	var game = {
		status: 'idle', // idle | playing | paused | over
		gen: 0,         // muda a cada reinício: invalida callbacks pendentes
		busy: false,    // animação em andamento: ignora cliques e pausa o cronômetro
		pizzas: [],
		slice: 0,
		duration: 0,
		remaining: 0,
		playTime: 0,
		score: 0,
		completed: 0,
		combo: 0,
		lives: LIVES,
		record: 0,
		muted: false,
		lastFrame: 0,
		lastWarn: -1,
		modal: null,         // janela aberta: { escape, pauseKeys }
		playerName: '',
		menuIndex: 0
	}

	/**
	 * localStorage pode falhar (modo privado, cookies bloqueados).
	**/
	function storageGet(key)
	{
		try { return localStorage.getItem(key) } catch (e) { return null }
	}

	function storageSet(key, value)
	{
		try { localStorage.setItem(key, value) } catch (e) {}
	}

	/**
	 * Sons gerados com Web Audio (sem arquivos).
	**/
	var audio = null

	var SOUNDS = {
		place:    [[660, 0, 0.06, 'square', 0.08]],
		complete: [[523, 0, 0.1], [659, 0.1, 0.1], [784, 0.2, 0.18]],
		lose:     [[220, 0, 0.3, 'sawtooth', 0.12]],
		tick:     [[880, 0, 0.04, 'square', 0.04]],
		levelup:  [[784, 0, 0.08], [1047, 0.08, 0.16]],
		gameover: [[392, 0, 0.22], [330, 0.22, 0.22], [262, 0.44, 0.5]]
	}

	function sound(name)
	{
		if (game.muted) return

		try {
			if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)()

			if (audio.state === 'suspended') audio.resume()

			var now = audio.currentTime

			SOUNDS[name].forEach(function (note) {
				var osc = audio.createOscillator()
				var gain = audio.createGain()
				var start = now + note[1]
				var end = start + note[2]

				osc.type = note[3] || 'triangle'
				osc.frequency.value = note[0]
				gain.gain.setValueAtTime(note[4] || 0.15, start)
				gain.gain.exponentialRampToValueAtTime(0.001, end)
				osc.connect(gain).connect(audio.destination)
				osc.start(start)
				osc.stop(end)
			})
		} catch (e) {}
	}

	function toggleMute()
	{
		game.muted = !game.muted

		storageSet(STORAGE_MUTED, game.muted ? '1' : '0')

		renderSound()

		sound('place')
	}

	function renderSound()
	{
		el.soundState.textContent = game.muted ? 'DESLIGADO' : 'LIGADO'
		el.menuSound.setAttribute('aria-pressed', String(!game.muted))
	}

	/**
	 * Monta as 6 pizzas e as fatias da pizza central.
	**/
	function createSlices(parent)
	{
		var slices = [null]

		for (var s = 1; s <= SLICES; s++)
		{
			var img = document.createElement('img')

			img.src = 'img/slice-' + s + '.png'
			img.alt = ''
			img.className = 'slice slice-' + s
			img.draggable = false

			parent.appendChild(img)
			slices.push(img)
		}

		return slices
	}

	function build()
	{
		el.pizzas = [null]
		el.slices = [null]

		for (var i = 1; i <= PIZZAS; i++)
		{
			var pizza = document.createElement('button')

			pizza.id = 'pizza-' + i
			pizza.className = 'pizza plate'
			pizza.setAttribute('aria-label', 'Pizza ' + i)
			pizza.addEventListener('click', onClick(onPizzaClick.bind(null, i)))

			el.slices.push(createSlices(pizza))

			var key = document.createElement('span')

			key.className = 'key'
			key.textContent = i
			pizza.appendChild(key)

			el.board.appendChild(pizza)
			el.pizzas.push(pizza)
		}

		el.randSlices = createSlices(el.rand)
	}

	/**
	 * Regras.
	**/
	function level()
	{
		return 1 + Math.floor(game.completed / PIZZAS_PER_LEVEL)
	}

	function sliceTime()
	{
		return Math.max(MIN_TIME, BASE_TIME - (level() - 1) * TIME_STEP)
	}

	function isFull(i)
	{
		for (var s = 1; s <= SLICES; s++)
		{
			if (!game.pizzas[i][s]) return false
		}

		return true
	}

	// Só sorteia fatias que cabem em alguma pizza (evita o loop infinito).
	function freeSlices()
	{
		var free = []

		for (var s = 1; s <= SLICES; s++)
		{
			for (var i = 1; i <= PIZZAS; i++)
			{
				if (!game.pizzas[i][s]) { free.push(s); break }
			}
		}

		return free
	}

	function nextSlice()
	{
		var free = freeSlices()

		if (free.length == 0) free = [1, 2, 3, 4, 5, 6, 7]

		game.slice = free[Math.floor(Math.random() * free.length)]
		game.duration = sliceTime()
		game.remaining = game.duration
		game.lastWarn = -1

		showRand(game.slice)

		el.rand.classList.remove('appear')
		void el.rand.offsetWidth
		el.rand.classList.add('appear')
	}

	function onPizzaClick(i)
	{
		if (game.status !== 'playing' || game.busy) return

		if (game.pizzas[i][game.slice])
		{
			wrong(i)
		}
		else
		{
			place(i)
		}
	}

	function place(i)
	{
		var gen = game.gen

		game.busy = true

		sound('place')

		var from = el.rand.getBoundingClientRect()
		var to = el.pizzas[i].getBoundingClientRect()
		var dx = to.left - from.left
		var dy = to.top - from.top

		el.center.classList.add('flying')

		var anim = el.rand.animate([
			{ transform: 'translate(0, 0)' },
			{ transform: 'translate(' + dx + 'px, ' + dy + 'px)' }
		], { duration: FLY_DURATION, easing: 'ease-in', fill: 'forwards' })

		anim.onfinish = function () {
			showRand(0)

			anim.cancel()

			el.center.classList.remove('flying')

			if (gen !== game.gen) return

			game.pizzas[i][game.slice] = true

			renderPizza(i)

			if (isFull(i)) complete(i)

			game.busy = false

			nextSlice()
		}
	}

	function complete(i)
	{
		var before = level()

		game.combo++
		game.completed++
		game.score += game.combo

		ghost(i, [1, 2, 3, 4, 5, 6, 7])

		popup(i, '+' + game.combo, game.combo > 1 ? 'COMBO x' + game.combo : '')

		sound(level() > before ? 'levelup' : 'complete')

		renderHud()
	}

	function wrong(i)
	{
		var pizza = el.pizzas[i]

		pizza.classList.remove('shake')
		void pizza.offsetWidth
		pizza.classList.add('shake')

		loseLife()

		if (game.status === 'playing') nextSlice()
	}

	// O tempo acabou: a fatia sorteada some de todas as pizzas.
	function timeout()
	{
		var gen = game.gen
		var s = game.slice

		game.busy = true
		game.remaining = 0

		showRand(0)

		for (var i = 1; i <= PIZZAS; i++)
		{
			if (game.pizzas[i][s]) ghost(i, [s])
		}

		loseLife()

		if (game.status !== 'playing' && game.status !== 'paused') return

		setTimeout(function () {
			if (gen !== game.gen) return

			game.busy = false

			nextSlice()
		}, TIMEOUT_DELAY)
	}

	function loseLife()
	{
		game.lives--
		game.combo = 0

		el.lives[game.lives].classList.add('lost')

		sound('lose')

		if (game.lives <= 0) gameOver()
	}

	function gameOver()
	{
		var newRecord = game.score > game.record

		game.status = 'over'
		game.busy = true

		showRand(0)

		if (newRecord)
		{
			game.record = game.score

			storageSet(STORAGE_RECORD, game.record)
		}

		renderHud()
		renderButtons()

		setTimeout(function () {
			sound('gameover')
		}, 300)

		var html =
			'<p>PONTOS: <span class="highlight">' + game.score + '</span></p>' +
			'<p>PIZZAS: ' + game.completed + ' &middot; TEMPO: ' + secToTime(Math.floor(game.playTime / 1000)) + '</p>' +
			(newRecord && game.score > 0 ? '<p class="highlight">NOVO RECORDE!</p>' : '<p>RECORDE: ' + game.record + '</p>')

		// Sem pontos não há o que gravar no ranking.
		if (game.score == 0)
		{
			openModal('GAME OVER', html, [
				{ label: 'INÍCIO', action: goHome },
				{ label: 'JOGAR DE NOVO', action: restart, primary: true }
			], { escape: goHome })

			return
		}

		openModal(
			'GAME OVER',
			html +
			'<form class="rank-form" id="rank-form" novalidate>' +
				'<label for="rank-name">COLOQUE SEU NOME NO RANKING</label>' +
				'<input id="rank-name" maxlength="16" autocomplete="nickname" spellcheck="false" placeholder="SEU NOME">' +
				'<p class="rank-msg" id="rank-msg" role="status"></p>' +
			'</form>',
			[
				{ label: 'INÍCIO', action: goHome },
				{ label: 'JOGAR DE NOVO', action: restart },
				{ label: 'SALVAR', action: submitScore, primary: true, keepOpen: true }
			],
			{ focus: '#rank-name' }
		)

		var input = document.getElementById('rank-name')

		input.value = game.playerName
		input.select()

		document.getElementById('rank-form').addEventListener('submit', function (e) {
			e.preventDefault()

			submitScore()
		})
	}

	/**
	 * Ranking (api/ranking.php).
	**/
	var savingScore = false

	function submitScore()
	{
		if (savingScore) return

		var input = document.getElementById('rank-name')
		var msg = document.getElementById('rank-msg')
		var name = input.value.replace(/\s+/g, ' ').trim()

		if (!/^[\p{L}\p{N} ._-]{2,16}$/u.test(name))
		{
			msg.textContent = 'Use de 2 a 16 letras ou números.'
			input.focus()

			return
		}

		savingScore = true
		msg.textContent = 'SALVANDO...'

		fetch(RANKING_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				name: name,
				score: game.score,
				pizzas: game.completed,
				level: level(),
				time: Math.max(1, Math.floor(game.playTime / 1000))
			})
		})
		.then(function (response) { return response.json() })
		.then(function (data) {
			savingScore = false

			if (!data.ok)
			{
				var error = new Error(data.error)

				error.fromServer = true

				throw error
			}

			game.playerName = name
			storageSet(STORAGE_NAME, name)

			showRankingTable(data, null, true)
		})
		.catch(function (error) {
			savingScore = false

			// A janela pode ter sido fechada enquanto salvava.
			if (!document.getElementById('rank-msg')) return

			msg.textContent = error.fromServer
				? error.message
				: 'Não foi possível salvar agora. Tente de novo.'
		})
	}

	// Busca o ranking e mostra. back: ação do botão principal.
	function showRanking(back)
	{
		fetch(RANKING_URL)
			.then(function (response) { return response.json() })
			.then(function (result) {
				if (!result.ok) throw new Error()

				showRankingTable(result, back)
			})
			.catch(function () {
				showRankingTable(null, back)
			})
	}

	/**
	 * Mostra o ranking.
	 *
	 * data:      resposta da API ({ top, position, entry }), ou null se falhou.
	 * back:      ação do "VOLTAR".
	 * afterGame: aberto depois de salvar a partida (botões INÍCIO e JOGAR DE NOVO).
	**/
	function showRankingTable(data, back, afterGame)
	{
		var html = ''

		if (!data)
		{
			html = '<p>O ranking está indisponível agora.</p>'
		}
		else if (!data.top.length)
		{
			html = '<p>Ninguém no ranking ainda. Seja o primeiro pizzaiolo!</p>'
		}
		else
		{
			var mine = data.position || 0

			html = '<table class="ranking">'

			data.top.forEach(function (entry, i) {
				html += rankingRow(i + 1, entry, i + 1 === mine)
			})

			// Fora do top 10: mostra a posição do jogador embaixo.
			if (mine > data.top.length && data.entry)
			{
				html += '<tr class="gap"><td colspan="3">...</td></tr>' + rankingRow(mine, data.entry, true)
			}

			html += '</table>'

			if (data.position && data.improved === false)
			{
				html += '<p class="stats">Seu melhor continua sendo ' + data.entry.score + ' pontos.</p>'
			}

			html += '<p class="stats">Clique em um jogador para ver os detalhes.</p>'
		}

		var buttons = afterGame
			? [{ label: 'INÍCIO', action: goHome }, { label: 'JOGAR DE NOVO', action: restart, primary: true }]
			: [{ label: 'VOLTAR', action: back, primary: true }]

		openModal('RANKING', html, buttons, { escape: afterGame ? goHome : back })

		// Linhas clicáveis: abrem os detalhes do jogador.
		el.modalBody.querySelectorAll('tr[data-position]').forEach(function (row) {
			var open = function () {
				var position = parseInt(row.getAttribute('data-position'), 10)
				var entry = position <= data.top.length ? data.top[position - 1] : data.entry

				closeModal(function () {
					showRankingDetail(entry, position, function () { showRankingTable(data, back, afterGame) })
				})
			}

			row.addEventListener('click', open)
			row.addEventListener('keydown', function (e) {
				if (e.key === 'Enter' || e.key === ' ')
				{
					e.preventDefault()

					open()
				}
			})
		})
	}

	function rankingRow(position, entry, mine)
	{
		return '<tr tabindex="0" data-position="' + position + '"' + (mine ? ' class="mine"' : '') + '>' +
			'<td>' + position + 'º</td>' +
			'<td>' + escapeHtml(entry.name) + '</td>' +
			'<td>' + entry.score + '</td>' +
		'</tr>'
	}

	var RANK_TITLES = ['MESTRE PIZZAIOLO', 'SUB-CHEF', 'FORNEIRO']

	function showRankingDetail(entry, position, back)
	{
		var date = new Date(entry.date)
		var pad = function (n) { return n < 10 ? '0' + n : '' + n }
		var when = isNaN(date)
			? '-'
			: pad(date.getDate()) + '/' + pad(date.getMonth() + 1) + '/' + date.getFullYear() + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
		var row = function (label, value) { return '<tr><td>' + label + '</td><td>' + value + '</td></tr>' }

		openModal(
			entry.name,
			'<p class="highlight">' + position + 'º LUGAR &middot; ' + (RANK_TITLES[position - 1] || 'APRENDIZ DE PIZZAIOLO') + '</p>' +
			'<table class="ranking detail">' +
				row('PONTOS', entry.score) +
				row('PIZZAS', entry.pizzas) +
				row('FASE', entry.level) +
				row('TEMPO', secToTime(entry.time)) +
				row('MÉDIA', (entry.score / Math.max(1, entry.pizzas)).toFixed(1).replace('.', ',') + ' pts/pizza') +
				row('DATA', when) +
			'</table>',
			[{ label: 'VOLTAR', action: back, primary: true }],
			{ escape: back }
		)
	}

	function escapeHtml(text)
	{
		var div = document.createElement('div')

		div.textContent = text

		return div.innerHTML
	}

	/**
	 * Controles.
	**/
	function start()
	{
		if (game.status === 'idle')
		{
			game.status = 'playing'

			nextSlice()
		}
		else if (game.status === 'paused')
		{
			game.status = 'playing'
		}
		else if (game.status === 'over')
		{
			restart()

			return
		}

		renderButtons()
	}

	function pause()
	{
		if (game.status !== 'playing') return

		game.status = 'paused'

		renderButtons()
	}

	// Mensagens sorteadas na tela de pausa.
	var PAUSE_MESSAGES = [
		{
			title: 'PAUSA PRO CAFÉ',
			body: 'O forno ficou em fogo baixo. Nada vai queimar enquanto você respira.',
			no: 'VOLTAR AO FORNO'
		},
		{
			title: 'INTERVALO!',
			body: 'O pizzaiolo foi buscar mais muçarela. A fatia do centro está <span class="highlight">guardadinha</span>.',
			no: 'BORA!'
		},
		{
			title: 'MASSA DESCANSANDO',
			body: 'Toda boa massa precisa descansar. O relógio parou e espera por você.',
			no: 'PODE ASSAR'
		},
		{
			title: 'FORNO EM ESPERA',
			body: 'Os clientes estão pacientes... por enquanto. Ninguém vai reclamar da demora.',
			no: 'ATENDER PEDIDOS'
		}
	]

	// Pausa automática ao trocar de aba.
	var AWAY_MESSAGE = {
		title: 'SAIU PRA ENTREGA?',
		body: 'Você saiu e a gente segurou o forno pra você. <span class="highlight">Nenhuma pizza queimou.</span>',
		no: 'VOLTEI!'
	}

	// Pausa e mostra a tela de pausa (o "continuar" fica em destaque).
	function showPause(away)
	{
		if (game.status === 'playing') pause()

		if (game.status !== 'paused' || !el.modal.hidden) return

		var msg = away === true ? AWAY_MESSAGE : PAUSE_MESSAGES[Math.floor(Math.random() * PAUSE_MESSAGES.length)]
		var hl = function (value) { return '<span class="highlight">' + value + '</span>' }

		openModal(
			msg.title,
			'<p>' + msg.body + '</p>' +
			'<p class="stats">PONTOS ' + hl(game.score) + ' &middot; FASE ' + hl(level()) + ' &middot; VIDAS ' + hl(game.lives) + '</p>',
			[
				{ label: 'SAIR', action: requestExit },
				{ label: msg.no, action: start, primary: true }
			],
			{ escape: start, pauseKeys: true }
		)
	}

	function togglePause()
	{
		if (game.status === 'playing')
		{
			showPause()
		}
		else
		{
			start()
		}
	}

	function reset()
	{
		game.gen++
		game.status = 'idle'
		game.busy = false
		game.pizzas = []
		game.slice = 0
		game.duration = 0
		game.remaining = 0
		game.playTime = 0
		game.score = 0
		game.completed = 0
		game.combo = 0
		game.lives = LIVES

		for (var i = 0; i <= PIZZAS; i++)
		{
			game.pizzas.push([])
		}

		el.rand.getAnimations().forEach(function (a) { a.cancel() })
		el.center.classList.remove('flying')

		document.querySelectorAll('.ghost, .pop').forEach(function (node) { node.remove() })

		el.lives.forEach(function (life) { life.classList.remove('lost') })

		for (var p = 1; p <= PIZZAS; p++)
		{
			el.pizzas[p].classList.remove('shake')

			renderPizza(p)
		}

		showRand(0)
		renderHud()
		renderButtons()
	}

	// Mensagens sorteadas ao pedir para sair no meio de uma partida.
	// {perda} vira, por exemplo, "12 pontos e 5 fatias".
	var EXIT_MESSAGES = [
		{
			title: 'JOGAR FORA?',
			body: 'Essas pizzas ainda estão <span class="highlight">quentinhas</span>! Se sair agora, adeus a {perda}.',
			yes: 'PODE JOGAR',
			no: 'NÃO, VOU COMER!'
		},
		{
			title: 'CALMA, PIZZAIOLO!',
			body: 'O forno ainda está ligado! Quer mesmo largar {perda} e ir embora?',
			yes: 'VOU EMBORA',
			no: 'VOLTAR AO FORNO'
		},
		{
			title: 'MAMMA MIA!',
			body: 'A nonna levou anos pra aprender essa receita. Sair agora joga fora {perda}.',
			yes: 'SIM, SAIR',
			no: 'DESCULPA, NONNA'
		},
		{
			title: 'FECHAR A PIZZARIA?',
			body: 'Tem cliente esperando no balcão! Sair agora deixa pra trás {perda}.',
			yes: 'FECHAR A LOJA',
			no: 'VOLTAR AO BALCÃO'
		}
	]

	// Quando ainda não há nada a perder.
	var NOTHING_LOST = 'uma pizzaria recém-aberta'

	// O que o jogador perde ao sair ("" se não há nada a perder).
	function progressLost()
	{
		var slices = 0
		var parts = []

		for (var i = 1; i <= PIZZAS; i++)
		{
			for (var s = 1; s <= SLICES; s++)
			{
				if (game.pizzas[i][s]) slices++
			}
		}

		if (game.score > 0) parts.push(game.score + (game.score == 1 ? ' ponto' : ' pontos'))
		if (slices > 0) parts.push(slices + (slices == 1 ? ' fatia' : ' fatias'))

		return parts.join(' e ')
	}

	// Pede confirmação antes de sair da partida e voltar à tela inicial.
	function requestExit()
	{
		if (game.status !== 'playing' && game.status !== 'paused')
		{
			goHome()

			return
		}

		var wasPlaying = game.status === 'playing'
		var msg = EXIT_MESSAGES[Math.floor(Math.random() * EXIT_MESSAGES.length)]

		// Desistiu de sair: volta ao jogo, ou à tela de pausa se veio dela.
		var cancel = function () { if (wasPlaying) start(); else showPause() }

		pause()

		openModal(
			msg.title,
			'<p>' + msg.body.replace('{perda}', '<span class="highlight">' + (progressLost() || NOTHING_LOST) + '</span>') + '</p>',
			[
				{ label: msg.yes, action: goHome },
				{ label: msg.no, action: cancel, primary: true }
			],
			{ escape: cancel }
		)
	}

	function restart()
	{
		reset()
		start()
	}

	/**
	 * Tela.
	**/
	function renderPizza(i)
	{
		for (var s = 1; s <= SLICES; s++)
		{
			el.slices[i][s].classList.toggle('on', !!game.pizzas[i][s])
		}
	}

	function showRand(slice)
	{
		for (var s = 1; s <= SLICES; s++)
		{
			el.randSlices[s].classList.toggle('on', s === slice)
		}
	}

	// Fatias que somem piscando. Usa cópias, então a pizza já fica livre na hora.
	function ghost(i, slices)
	{
		slices.forEach(function (s) {
			var copy = el.slices[i][s].cloneNode(false)

			copy.classList.remove('on')
			copy.classList.add('ghost')
			copy.addEventListener('animationend', function () { copy.remove() })

			el.pizzas[i].appendChild(copy)

			game.pizzas[i][s] = false
		})

		renderPizza(i)
	}

	function popup(i, text, subtext)
	{
		var pop = document.createElement('div')

		pop.className = 'pop'
		pop.textContent = text

		if (subtext)
		{
			var small = document.createElement('small')

			small.textContent = subtext
			pop.appendChild(small)
		}

		pop.addEventListener('animationend', function () { pop.remove() })

		el.pizzas[i].appendChild(pop)
	}

	function renderHud()
	{
		el.score.textContent = game.score
		el.record.textContent = Math.max(game.record, game.score)
		el.level.textContent = level()
	}

	function renderButtons()
	{
		el.board.classList.toggle('paused', game.status === 'paused')
	}

	function renderTimer()
	{
		var ratio = game.duration ? Math.max(0, game.remaining / game.duration) : 0

		el.timerFill.style.transform = 'scaleX(' + ratio + ')'
		el.timerFill.classList.toggle('warn', ratio > 0 && game.remaining <= WARN_TIME * 1.5)
		el.timerFill.classList.toggle('danger', ratio > 0 && game.remaining <= WARN_TIME)
	}

	var shownSeconds = -1

	function renderClock()
	{
		var seconds = Math.floor(game.playTime / 1000)

		if (seconds === shownSeconds) return

		shownSeconds = seconds

		el.clock.textContent = secToTime(seconds)
	}

	function secToTime(num)
	{
		var hours = Math.floor(num / 3600)
		var minutes = Math.floor((num % 3600) / 60)
		var seconds = num % 60
		var pad = function (n) { return n < 10 ? '0' + n : '' + n }

		return (hours > 0 ? hours + ':' : '') + pad(minutes) + ':' + pad(seconds)
	}

	/**
	 * Laço principal: conta o tempo só enquanto o jogo está rodando.
	**/
	function frame(now)
	{
		// Limita o salto se o navegador ficar um tempo sem desenhar.
		var dt = Math.min(now - game.lastFrame, 100)

		game.lastFrame = now

		if (game.status === 'playing')
		{
			game.playTime += dt

			if (!game.busy)
			{
				game.remaining -= dt

				var second = Math.ceil(game.remaining / 1000)

				if (game.remaining > 0 && game.remaining <= WARN_TIME && second !== game.lastWarn)
				{
					game.lastWarn = second

					sound('tick')
				}

				if (game.remaining <= 0) timeout()
			}
		}

		renderTimer()
		renderClock()

		requestAnimationFrame(frame)
	}

	/**
	 * Janela de mensagens.
	**/
	/**
	 * Abre a janela de mensagens.
	 *
	 * buttons: [{ label, action, primary, keepOpen }]. O botão primary fica
	 *          em destaque e recebe o foco; keepOpen não fecha a janela.
	 * options: { escape: ação do Esc, pauseKeys: Espaço/P também fazem o Esc,
	 *            focus: seletor do campo que recebe o foco }
	**/
	function openModal(title, html, buttons, options)
	{
		options = options || {}

		var focus = null

		el.modalTitle.textContent = title
		el.modalBody.innerHTML = html
		el.modalActions.textContent = ''

		buttons.forEach(function (b) {
			var button = document.createElement('button')

			button.type = 'button'
			button.className = 'modal-btn' + (b.primary ? ' primary' : '')
			button.textContent = b.label
			button.addEventListener('click', function () {
				if (b.keepOpen)
				{
					b.action()
				}
				else
				{
					closeModal(b.action)
				}
			})

			if (b.primary || !focus) focus = button

			el.modalActions.appendChild(button)
		})

		game.modal = { escape: options.escape || null, pauseKeys: !!options.pauseKeys }

		el.modal.hidden = false

		positionModal()

		if (options.focus) focus = el.modalBody.querySelector(options.focus)

		setTimeout(function () { if (focus) focus.focus() }, 50)
	}

	// Centraliza a caixa no meio do tabuleiro (não da janela), sem sair da tela.
	function positionModal()
	{
		if (el.modal.hidden) return

		var box = el.modal.firstElementChild
		var center = el.center.getBoundingClientRect()

		// Na tela inicial o tabuleiro está escondido: usa o meio da janela.
		var middle = el.game.hidden ? window.innerHeight / 2 : center.top + center.height / 2
		var free = window.innerHeight - box.offsetHeight - 32

		box.style.marginTop = Math.max(0, Math.min(middle - 16 - box.offsetHeight / 2, free)) + 'px'
	}

	function closeModal(action)
	{
		el.modal.hidden = true

		game.modal = null

		if (action) action()
	}

	function dismissModal()
	{
		if (game.modal && game.modal.escape) closeModal(game.modal.escape)
	}

	/**
	 * Tela inicial.
	**/
	function buildHome()
	{
		// Pizza que se monta sozinha, fatia por fatia.
		for (var s = 1; s <= SLICES; s++)
		{
			var img = document.createElement('img')

			img.src = 'img/slice-' + s + '.png'
			img.alt = ''
			img.style.setProperty('--i', s - 1)

			el.heroPizza.appendChild(img)
		}

		// Fatias caindo ao fundo.
		for (var i = 0; i < 12; i++)
		{
			var drop = document.createElement('img')
			var size = 40 + Math.random() * 50

			drop.src = 'img/slice-' + (1 + i % SLICES) + '.png'
			drop.alt = ''
			drop.style.left = (i / 12 * 100 + Math.random() * 6) + '%'
			drop.style.width = size + 'px'
			drop.style.animationDuration = (9 + Math.random() * 9) + 's'
			drop.style.animationDelay = (-Math.random() * 18) + 's'
			drop.style.setProperty('--spin', (Math.random() < 0.5 ? -1 : 1) * (180 + Math.random() * 360) + 'deg')

			el.rain.appendChild(drop)
		}
	}

	function showHome()
	{
		el.game.hidden = true
		el.home.hidden = false

		el.homeRecord.textContent = game.record

		// 1º lugar do ranking no rodapé (se o servidor responder).
		fetch(RANKING_URL)
			.then(function (response) { return response.json() })
			.then(function (data) {
				var first = data.ok && data.top[0]

				el.homeTop.hidden = !first

				if (!first) return

				el.homeTopName.textContent = first.name
				el.homeTopScore.textContent = first.score
			})
			.catch(function () { el.homeTop.hidden = true })

		focusMenu()
	}

	// Sai da partida (já confirmado) e volta para a tela inicial.
	function goHome()
	{
		reset()
		showHome()
	}

	function startGame()
	{
		el.home.hidden = true
		el.game.hidden = false

		restart()
	}

	function focusMenu()
	{
		if (el.home.hidden || !el.modal.hidden) return

		var items = el.menu.querySelectorAll('.menu-item')
		var current = items[game.menuIndex] || items[0]

		setTimeout(function () { current.focus() }, 50)
	}

	// Setas para cima/baixo percorrem o menu, como num fliperama.
	function moveMenu(step)
	{
		var items = Array.prototype.slice.call(el.menu.querySelectorAll('.menu-item'))
		var index = items.indexOf(document.activeElement)

		index = index < 0 ? 0 : (index + step + items.length) % items.length

		items[index].focus()
	}

	function showHelp()
	{
		openModal(
			'COMO JOGAR',
			'<ul>' +
				'<li>Uma fatia aparece no <span class="highlight">centro</span>. Clique na pizza onde ela deve entrar.</li>' +
				'<li>Não repita: cada pizza só aceita <span class="highlight">uma fatia de cada tipo</span>.</li>' +
				'<li>Complete as 7 fatias para fechar a pizza. Pizzas seguidas sem errar valem <span class="highlight">combo</span>.</li>' +
				'<li>Se o tempo acabar, a fatia some de <span class="highlight">todas</span> as pizzas.</li>' +
				'<li>Errar ou deixar o tempo acabar custa uma vida. O tempo diminui a cada fase.</li>' +
				'<li>Teclado: <span class="highlight">1-6</span> pizzas, <span class="highlight">Espaço</span> pausa, <span class="highlight">Esc</span> sai.</li>' +
			'</ul>',
			[
				{ label: 'VOLTAR', action: focusMenu },
				{ label: 'JOGAR', action: startGame, primary: true }
			],
			{ escape: focusMenu }
		)
	}

	// Clique de mouse/toque tira o foco do botão, para o contorno de
	// foco não aparecer quando o jogador passar a usar o teclado.
	function onClick(handler)
	{
		return function (e) {
			if (e.detail > 0) e.currentTarget.blur()

			handler()
		}
	}

	/**
	 * Teclado.
	**/
	function onKeyDown(e)
	{
		if (e.ctrlKey || e.altKey || e.metaKey) return

		if (!el.modal.hidden)
		{
			if (e.key === 'Escape')
			{
				dismissModal()
			}
			else if ((e.key === ' ' || e.key.toLowerCase() === 'p') && game.modal && game.modal.pauseKeys)
			{
				// Espaço/P na pausa: volta ao jogo (o "cancelar" é sempre o lado seguro).
				e.preventDefault()

				if (document.activeElement) document.activeElement.blur()

				dismissModal()
			}

			return
		}

		var key = e.key.toLowerCase()

		if (!el.home.hidden)
		{
			if (e.key === 'ArrowDown' || e.key === 'ArrowUp')
			{
				e.preventDefault()

				moveMenu(e.key === 'ArrowDown' ? 1 : -1)
			}
			else if (key === 'm')
			{
				toggleMute()
			}

			return
		}

		if (key >= '1' && key <= String(PIZZAS))
		{
			onPizzaClick(parseInt(key, 10))
		}
		else if (key === ' ' || key === 'p')
		{
			// Evita que o Espaço também "clique" no botão que estiver em foco.
			e.preventDefault()

			if (document.activeElement) document.activeElement.blur()

			togglePause()
		}
		else if (e.key === 'Escape')
		{
			requestExit()
		}
		else if (key === 'm')
		{
			toggleMute()
		}
	}

	function init()
	{
		el.board = document.getElementById('board')
		el.center = document.getElementById('center')
		el.rand = document.getElementById('rand')
		el.timerFill = document.getElementById('timer-fill')
		el.clock = document.getElementById('clock')
		el.level = document.getElementById('level')
		el.score = document.getElementById('score')
		el.record = document.getElementById('record')
		el.lives = [1, 2, 3].map(function (n) { return document.getElementById('life-' + n) })
		el.btnPause = document.getElementById('btn-pause')
		el.btnExit = document.getElementById('btn-exit')
		el.home = document.getElementById('home')
		el.game = document.getElementById('game')
		el.heroPizza = document.getElementById('hero-pizza')
		el.rain = document.getElementById('rain')
		el.menu = document.getElementById('menu')
		el.menuSound = document.getElementById('menu-sound')
		el.soundState = document.getElementById('sound-state')
		el.homeRecord = document.getElementById('home-record')
		el.homeTop = document.getElementById('home-top')
		el.homeTopName = document.getElementById('home-top-name')
		el.homeTopScore = document.getElementById('home-top-score')
		el.modal = document.getElementById('modal')
		el.modalTitle = document.getElementById('modal-title')
		el.modalBody = document.getElementById('modal-body')
		el.modalActions = document.getElementById('modal-actions')

		game.record = parseInt(storageGet(STORAGE_RECORD), 10) || 0
		game.muted = storageGet(STORAGE_MUTED) === '1'
		game.playerName = storageGet(STORAGE_NAME) || ''

		renderSound()

		build()
		buildHome()
		reset()

		el.btnPause.addEventListener('click', onClick(showPause))
		el.btnExit.addEventListener('click', onClick(requestExit))

		document.getElementById('menu-play').addEventListener('click', startGame)
		document.getElementById('menu-help').addEventListener('click', showHelp)
		document.getElementById('menu-ranking').addEventListener('click', function () { showRanking(focusMenu) })
		el.menuSound.addEventListener('click', toggleMute)

		// Lembra o item do menu em foco, para devolver o foco ao voltar.
		el.menu.addEventListener('focusin', function (e) {
			game.menuIndex = Array.prototype.indexOf.call(el.menu.children, e.target)
		})

		document.addEventListener('keydown', onKeyDown)

		window.addEventListener('resize', positionModal)

		if (document.fonts) document.fonts.ready.then(positionModal)

		// Pausa sozinho ao trocar de aba.
		document.addEventListener('visibilitychange', function () {
			if (document.hidden) showPause(true)
		})

		game.lastFrame = performance.now()

		requestAnimationFrame(frame)

		showHome()
	}

	document.addEventListener('DOMContentLoaded', init)
})()
