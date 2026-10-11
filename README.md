# Pizza Click

Jogo de raciocínio rápido feito em HTML, CSS e JavaScript puro, sem dependências.

## Como jogar

- Uma fatia aparece na pizza do **centro**. Clique na pizza onde ela deve entrar.
- Cada pizza só aceita **uma fatia de cada tipo** (são 7 tipos). Colocar uma fatia repetida custa uma vida.
- Complete as 7 fatias para fechar a pizza e ganhar pontos. Pizzas seguidas sem errar formam **combo**: a 1ª vale +1, a 2ª +2, a 3ª +3...
- Cada fatia tem um tempo limite, mostrado pela barra abaixo do centro. Se o tempo acabar, aquela fatia **some de todas as pizzas** e você perde uma vida.
- A cada 2 pizzas completadas o jogo sobe de fase e o tempo diminui (de 10s até 3s).
- São 3 vidas. O recorde fica salvo no navegador.

## Controles

| Ação            | Mouse / toque       | Teclado  |
|-----------------|---------------------|----------|
| Escolher pizza  | Clique na pizza     | `1`–`6`  |
| Jogar / pausar  | ▶ / ❚❚              | `Espaço` |
| Reiniciar       | ⟳                   | `R`      |
| Som liga/desliga| 🔊                  | `M`      |

O jogo pausa sozinho quando você troca de aba.

## Executando

Abra `index.html` por um servidor web local (por exemplo o XAMPP, em `http://localhost/pizza/`).
Abrindo direto pelo arquivo (`file://`), alguns navegadores bloqueiam o carregamento das fontes.

## Estrutura

```
index.html      página e layout do tabuleiro
css/style.css   estilos e animações (layout responsivo, funciona no celular)
css/fonts/      fonte Press Start 2P e ícones
js/main.js      lógica do jogo
img/            imagens das fatias, vidas e fundo
```
