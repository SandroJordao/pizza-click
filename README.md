# Pizza Click

Jogo de raciocínio rápido feito em HTML, CSS e JavaScript puro, sem dependências.

## Como jogar

- Uma fatia aparece na pizza do **centro**. Clique na pizza onde ela deve entrar.
- Cada pizza só aceita **uma fatia de cada tipo** (são 7 tipos). Colocar uma fatia repetida custa uma vida.
- Complete as 7 fatias para fechar a pizza e ganhar pontos. Pizzas seguidas sem errar formam **combo**: a 1ª vale +1, a 2ª +2, a 3ª +3...
- Cada fatia tem um tempo limite, mostrado pela barra abaixo do centro. Se o tempo acabar, aquela fatia **some de todas as pizzas** e você perde uma vida.
- A cada 2 pizzas completadas o jogo sobe de fase e o tempo diminui (de 10s até 3s).
- São 3 vidas. O recorde fica salvo no navegador.
- Ao perder as 3 vidas, você pode colocar seu nome no **ranking**. Cada nome aparece uma vez, com a melhor pontuação.

## Tela inicial

Menu com **Jogar**, **Instruções**, **Ranking** (top 10; clique em um jogador para ver os detalhes da partida) e **Som** (liga/desliga). Use o mouse ou as setas ↑ ↓ e Enter.

## Controles

| Ação            | Mouse / toque       | Teclado  |
|-----------------|---------------------|----------|
| Escolher pizza  | Clique na pizza     | `1`–`6`  |
| Pausar          | ❚❚                  | `Espaço` |
| Sair (pede confirmação e volta à tela inicial) | ⇥ | `Esc` |

O jogo pausa sozinho quando você troca de aba.

## Executando

Rode por um servidor web com PHP (por exemplo o XAMPP, em `http://localhost/pizza/`).
O jogo funciona aberto direto pelo arquivo (`file://`), mas aí o ranking fica indisponível e alguns navegadores bloqueiam as fontes.

## Ranking

O ranking é gravado pela `api/ranking.php` no arquivo `data/ranking.json`, criado automaticamente.

- No servidor, a pasta `data/` precisa ter **permissão de escrita** para o PHP.
- O `data/.htaccess` bloqueia o acesso direto ao arquivo (Apache).
- A API confere se a partida é possível (pontos, pizzas, fase e tempo), valida o nome e limita um envio a cada 10 segundos por IP. Isso evita abusos simples, mas como a pontuação vem do navegador, não impede alguém determinado a forjar um resultado.
- Para zerar o ranking, apague `data/ranking.json`.

## Estrutura

```
index.html      página e layout do tabuleiro
css/style.css   estilos e animações (layout responsivo, funciona no celular)
css/fonts/      fonte Press Start 2P e ícones
js/main.js      lógica do jogo
img/            imagens das fatias, vidas e fundo
api/ranking.php API do ranking (GET lista, POST grava)
data/           ranking.json (gerado, fora do git)
```
