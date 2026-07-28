DEUCE SCORE — Cloudflare Migration Package
===========================================

O que tem aqui
----------------
- /functions/api/*.js       → as 13 funções de API, reescritas pro formato do
                              Cloudflare Pages Functions (rodam junto com o
                              site, sob o caminho /api/...)
- /reminders-worker/        → um Worker separado, com agendamento (cron) a
                              cada 15 minutos, equivalente ao antigo
                              check-reminders.js do Netlify
- package.json (dois, um em cada pasta) → dependência única:
  @block65/webcrypto-web-push (o "web-push" original NÃO funciona no
  Cloudflare; essa é a alternativa que funciona, usando Web Crypto nativo)

Diferença de armazenamento
-----------------------------
No Netlify usávamos 5 "gavetas" separadas (Blobs). No Cloudflare, tudo fica
num único espaço chamado KV, com um "prefixo" no nome de cada chave pra
separar os tipos de dado:
  reminders:{matchId}
  players:{email}
  invites:{inviteId}
  pending-results:{resultId}
  email-verifications:{email}

Isso significa que só precisa criar UM namespace de KV (não cinco).


PASSO A PASSO PRA CONFIGURAR
================================

1) Criar conta grátis em dash.cloudflare.com (se ainda não tiver)

2) Criar o KV namespace
   - No painel: Workers & Pages → KV → Create a namespace
   - Nome: deuce-score-data (ou qualquer nome)
   - Guarda o ID gerado, vamos precisar dele

3) Criar o projeto Pages (o site + as 13 funções de API)
   - Workers & Pages → Create → Pages → Connect to Git
   - Escolhe o MESMO repositório do GitHub que você já usa
     (o Cloudflare vai olhar pra pasta /functions automaticamente —
     a pasta /netlify que já existe não atrapalha em nada)
   - Build settings: pode deixar em branco / "no build command",
     já que não usamos framework nenhum
   - Depois de criado: vai em Settings → Functions → KV namespace bindings
     → adiciona uma com nome "DEUCE_KV" apontando pro namespace do passo 2

4) Criar o Worker de lembretes (separado do site)
   - Workers & Pages → Create → Workers → Connect to Git
   - Aponta pra MESMA repo, mas define a "pasta raiz" como
     /reminders-worker (isso o Cloudflare pergunta na configuração)
   - Depois de criado: Settings → Triggers → Cron Triggers
     → adiciona */15 * * * * (a cada 15 minutos) — caso não puxe
     automático do wrangler.toml
   - Settings → Bindings → KV namespace → adiciona "DEUCE_KV"
     apontando pro mesmo namespace do passo 2

5) Variáveis de ambiente (nos dois: Pages e no Worker)
   - VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
     (as mesmas chaves que já usa no Netlify — não precisa gerar de novo)
   - BREVO_API_KEY, BREVO_SENDER_EMAIL
     (as mesmas do Netlify também)

6) Testar
   - O Cloudflare te dá um link tipo algumacoisa.pages.dev
   - Testa cada funcionalidade (agendar, convidar, verificar e-mail)
     nesse link antes de pensar em migrar de vez


O QUE AINDA PRECISA SER FEITO (não incluído neste pacote)
-------------------------------------------------------------
- O client (index.html) ainda aponta pros caminhos antigos do Netlify de
  forma implícita (usa caminhos relativos tipo /.netlify/functions/... —
  isso PRECISA mudar pra /api/... antes de funcionar no Cloudflare)
- Testes reais end-to-end (não dá pra testar nesse ambiente sem acesso
  a internet)
