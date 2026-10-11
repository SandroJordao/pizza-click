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
		modalAction: null
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

		el.btnSound.classList.toggle('muted', game.muted)
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

		openModal(
			'GAME OVER',
			'<p>PONTOS: <span class="highlight">' + game.score + '</span></p>' +
			'<p>PIZZAS: ' + game.completed + ' &middot; TEMPO: ' + secToTime(Math.floor(game.playTime / 1000)) + '</p>' +
			(newRecord && game.score > 0 ? '<p class="highlight">NOVO RECORDE!</p>' : '<p>RECORDE: ' + game.record + '</p>'),
			'JOGAR DE NOVO',
			restart
		)
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

	function togglePause()
	{
		if (game.status === 'playing')
		{
			pause()
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
		var playing = game.status === 'playing'

		el.btnPlay.hidden = playing
		el.btnPause.hidden = !playing
		el.btnReload.hidden = game.status === 'idle'

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
	function openModal(title, html, button, action)
	{
		el.modalTitle.textContent = title
		el.modalBody.innerHTML = html
		el.modalOk.textContent = button
		el.modal.hidden = false

		game.modalAction = action

		positionModal()

		setTimeout(function () { el.modalOk.focus() }, 50)
	}

	// Centraliza a caixa no meio do tabuleiro (não da janela), sem sair da tela.
	function positionModal()
	{
		if (el.modal.hidden) return

		var box = el.modal.firstElementChild
		var center = el.center.getBoundingClientRect()
		var middle = center.top + center.height / 2
		var free = window.innerHeight - box.offsetHeight - 32

		box.style.marginTop = Math.max(0, Math.min(middle - 16 - box.offsetHeight / 2, free)) + 'px'
	}

	function closeModal()
	{
		var action = game.modalAction

		el.modal.hidden = true

		game.modalAction = null

		if (action) action()
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
				'<li>Teclado: <span class="highlight">1-6</span> pizzas, <span class="highlight">Espaço</span> pausa, <span class="highlight">R</span> reinicia, <span class="highlight">M</span> som.</li>' +
			'</ul>',
			'JOGAR',
			start
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
			if (e.key === 'Escape') closeModal()

			return
		}

		var key = e.key.toLowerCase()

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
		else if (key === 'r')
		{
			restart()
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
		el.btnPlay = document.getElementById('btn-play')
		el.btnPause = document.getElementById('btn-pause')
		el.btnReload = document.getElementById('btn-reload')
		el.btnSound = document.getElementById('btn-sound')
		el.modal = document.getElementById('modal')
		el.modalTitle = document.getElementById('modal-title')
		el.modalBody = document.getElementById('modal-body')
		el.modalOk = document.getElementById('modal-ok')

		game.record = parseInt(storageGet(STORAGE_RECORD), 10) || 0
		game.muted = storageGet(STORAGE_MUTED) === '1'

		el.btnSound.classList.toggle('muted', game.muted)

		build()
		reset()

		el.btnPlay.addEventListener('click', onClick(start))
		el.btnPause.addEventListener('click', onClick(pause))
		el.btnReload.addEventListener('click', onClick(restart))
		el.btnSound.addEventListener('click', onClick(toggleMute))
		el.modalOk.addEventListener('click', closeModal)

		document.addEventListener('keydown', onKeyDown)

		window.addEventListener('resize', positionModal)

		if (document.fonts) document.fonts.ready.then(positionModal)

		// Pausa sozinho ao trocar de aba.
		document.addEventListener('visibilitychange', function () {
			if (document.hidden) pause()
		})

		game.lastFrame = performance.now()

		requestAnimationFrame(frame)

		showHelp()
	}

	document.addEventListener('DOMContentLoaded', init)
})()
