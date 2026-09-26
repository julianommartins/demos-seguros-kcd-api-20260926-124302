'use strict';
const Fastify = require('fastify');
const cors = require('@fastify/cors');
const { Pool } = require('pg');

const SEGURADORA = process.env.INSURER_NAME || 'Seguros KCD';
const COR_PREDOMINANTE = process.env.PRIMARY_COLOR || '#003399';

// Prefixo das variáveis injetadas pelo Service Link (<SERVIÇO>_<ATRIBUTO>), detectado em runtime
const P = process.env.DB_ENV_PREFIX
  || Object.keys(process.env).filter((k) => k.endsWith('_DATABASE_NAME')).map((k) => k.slice(0, -'_DATABASE_NAME'.length))
       .sort((a, b) => (a === 'POSTGRES_SERVER_DEMOS') - (b === 'POSTGRES_SERVER_DEMOS'))[0]
  || 'CATALOGO_DB';
const env = (k) => process.env[`${P}_${k}`];
const faltando = ['HOSTNAME', 'PORT', 'DATABASE_NAME', 'USERNAME', 'PASSWORD'].filter((k) => !env(k));
if (faltando.length) { console.error(`Variáveis de conexão ausentes: ${faltando.map((k) => `${P}_${k}`)}`); process.exit(1); }
const pool = new Pool({
  host: env('HOSTNAME'), port: Number(env('PORT') || 5432), database: env('DATABASE_NAME'),
  user: env('USERNAME'), password: env('PASSWORD'),
  ssl: { rejectUnauthorized: false }, max: 5, connectionTimeoutMillis: 5000 });
pool.on('error', (err) => console.error(`Erro no pool do banco: ${err.message}`));

let bancoPronto = false;
let ultimoErroBanco = null;

const SEED = [
  ['🚗', 'Seguro Auto', 'Automóvel', 139.90, 'Colisão, furto, roubo, terceiros e guincho 24h sem limite',
    `Proteção completa para o seu carro com a rede de oficinas credenciadas ${SEGURADORA} em todo o Brasil.`],
  ['📱', 'Seguro Celular', 'Eletrônicos', 34.90, 'Quebra acidental, furto qualificado, roubo e danos elétricos',
    `Seu smartphone protegido contra imprevistos do dia a dia, com reparo rápido na assistência ${SEGURADORA}.`],
  ['✈️', 'Seguro Viagem', 'Viagem', 27.90, 'Assistência médica internacional, telemedicina e bagagem',
    `Viaje tranquilo: atendimento médico no exterior e suporte 24h da central ${SEGURADORA}.`],
  ['🏠', 'Seguro Residencial', 'Residencial', 49.90, 'Incêndio, vendaval, danos elétricos e serviços emergenciais',
    `Sua casa protegida, com chaveiro, encanador e eletricista da rede credenciada ${SEGURADORA}.`],
  ['❤️', 'Seguro de Vida', 'Vida', 42.00, 'Morte, invalidez e doenças graves',
    `Tranquilidade financeira para quem você ama, com a solidez da ${SEGURADORA}.`],
  ['🏎️', 'Seguro Auto Premium', 'Automóvel', 349.00, 'Alto padrão e blindados, peças genuínas e carro reserva',
    `Cobertura exclusiva para veículos de alto padrão e blindados, com atendimento VIP ${SEGURADORA}.`],
  ['🚚', 'Seguro Frotas Empresariais', 'Corporativo', 199.00, 'Frotas e vans com rastreamento e suporte 24h',
    `Proteja a operação da sua empresa: frotas e vans com gestão de sinistros ${SEGURADORA}.`],
  ['💼', 'Seguro Vida Premium', 'Vida', 180.00, 'Capital estendido, consultoria sucessória e check-up anual',
    `Planejamento de vida completo com consultoria especializada ${SEGURADORA}.`],
  ['🚲', 'Seguro Bike', 'Mobilidade', 29.90, 'Bicicletas urbanas e elétricas: roubo e transporte',
    `Pedale sem preocupação: sua bike convencional ou elétrica coberta pela ${SEGURADORA}.`],
  ['💻', 'Seguro Equipamentos Profissionais', 'Eletrônicos', 62.00, 'Notebooks, câmeras e tablets em trânsito',
    `Seus equipamentos de trabalho protegidos em qualquer lugar, com reposição ágil ${SEGURADORA}.`],
];

async function iniciarBanco() {
  for (;;) {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS catalogo_seguros (
        id SERIAL PRIMARY KEY, titulo VARCHAR(150) NOT NULL, descricao TEXT NOT NULL,
        imagem VARCHAR(16) NOT NULL, categoria VARCHAR(50) NOT NULL, valor_mensal NUMERIC(10,2) NOT NULL,
        cobertura_destaque VARCHAR(250) NOT NULL,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now(), atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now())`);
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM catalogo_seguros');
      if (rows[0].n === 0) {
        for (const [imagem, titulo, categoria, valor, cobertura, descricao] of SEED) {
          await pool.query(
            'INSERT INTO catalogo_seguros (titulo, descricao, imagem, categoria, valor_mensal, cobertura_destaque) VALUES ($1,$2,$3,$4,$5,$6)',
            [titulo, descricao, imagem, categoria, valor, cobertura]);
        }
        console.log(`Seed: ${SEED.length} seguros inseridos`);
      }
      bancoPronto = true; ultimoErroBanco = null;
      console.log(`Banco pronto (${env('DATABASE_NAME')} em ${env('HOSTNAME')})`);
      return;
    } catch (err) {
      ultimoErroBanco = `${err.code || ''} ${err.message}`.trim();
      console.error(`Falha ao iniciar o banco, nova tentativa em 5 s: ${ultimoErroBanco}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

const app = Fastify({ logger: true });
app.register(cors, { origin: true });

const paraJson = (r) => ({ ...r, valor_mensal: Number(r.valor_mensal) });
const CAMPOS = ['titulo', 'descricao', 'imagem', 'categoria', 'valor_mensal', 'cobertura_destaque'];

function validar(body) {
  if (!body || typeof body !== 'object') return 'Corpo da requisição inválido.';
  const faltam = CAMPOS.filter((c) => body[c] === undefined || body[c] === null || String(body[c]).trim() === '');
  if (faltam.length) return `Campos obrigatórios ausentes: ${faltam.join(', ')}.`;
  if (Buffer.byteLength(String(body.imagem), 'utf8') > 16) return 'O campo imagem deve conter apenas um emoji (até 16 bytes).';
  if (Number.isNaN(Number(body.valor_mensal)) || Number(body.valor_mensal) < 0) return 'O valor mensal deve ser um número positivo.';
  if (String(body.titulo).length > 150) return 'O título deve ter no máximo 150 caracteres.';
  if (String(body.categoria).length > 50) return 'A categoria deve ter no máximo 50 caracteres.';
  if (String(body.cobertura_destaque).length > 250) return 'A cobertura destaque deve ter no máximo 250 caracteres.';
  return null;
}
const idValido = (id) => /^\d+$/.test(String(id));

function exigeBanco(reply) {
  if (bancoPronto) return true;
  reply.code(503).send({ erro: 'Banco de dados indisponível no momento. Tente novamente em instantes.' });
  return false;
}

app.get('/health', async () => ({ status: 'ok' }));

app.get('/api/status', async (req, reply) => {
  try {
    if (!bancoPronto) throw new Error(ultimoErroBanco || 'Banco ainda inicializando');
    await pool.query('SELECT 1');
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM catalogo_seguros');
    return { status: 'online', seguradora: SEGURADORA, corPredominante: COR_PREDOMINANTE, bancoConectado: true, totalSeguros: rows[0].n };
  } catch (err) {
    return reply.code(503).send({ status: 'online', seguradora: SEGURADORA, corPredominante: COR_PREDOMINANTE,
      bancoConectado: false, erro: ultimoErroBanco || err.message,
      host: env('HOSTNAME'), banco: env('DATABASE_NAME'), usuario: env('USERNAME') });
  }
});

app.get('/api/seguros', async (req, reply) => {
  if (!exigeBanco(reply)) return;
  const { busca, categoria } = req.query || {};
  const cond = []; const params = [];
  if (busca && String(busca).trim()) { params.push(`%${String(busca).trim()}%`); cond.push(`(titulo ILIKE $${params.length} OR descricao ILIKE $${params.length})`); }
  if (categoria && String(categoria).trim()) { params.push(String(categoria).trim()); cond.push(`categoria = $${params.length}`); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const { rows } = await pool.query(`SELECT * FROM catalogo_seguros ${where} ORDER BY id`, params);
  return rows.map(paraJson);
});

app.get('/api/seguros/:id', async (req, reply) => {
  if (!exigeBanco(reply)) return;
  if (!idValido(req.params.id)) return reply.code(400).send({ erro: 'Identificador inválido.' });
  const { rows } = await pool.query('SELECT * FROM catalogo_seguros WHERE id = $1', [req.params.id]);
  if (!rows.length) return reply.code(404).send({ erro: 'Seguro não encontrado.' });
  return paraJson(rows[0]);
});

app.post('/api/seguros', async (req, reply) => {
  if (!exigeBanco(reply)) return;
  const erro = validar(req.body); if (erro) return reply.code(400).send({ erro });
  const b = req.body;
  const { rows } = await pool.query(
    'INSERT INTO catalogo_seguros (titulo, descricao, imagem, categoria, valor_mensal, cobertura_destaque) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [String(b.titulo).trim(), String(b.descricao).trim(), String(b.imagem).trim(), String(b.categoria).trim(), Number(b.valor_mensal), String(b.cobertura_destaque).trim()]);
  return reply.code(201).send(paraJson(rows[0]));
});

app.put('/api/seguros/:id', async (req, reply) => {
  if (!exigeBanco(reply)) return;
  if (!idValido(req.params.id)) return reply.code(400).send({ erro: 'Identificador inválido.' });
  const erro = validar(req.body); if (erro) return reply.code(400).send({ erro });
  const b = req.body;
  const { rows } = await pool.query(
    `UPDATE catalogo_seguros SET titulo=$1, descricao=$2, imagem=$3, categoria=$4, valor_mensal=$5, cobertura_destaque=$6, atualizado_em=now()
     WHERE id=$7 RETURNING *`,
    [String(b.titulo).trim(), String(b.descricao).trim(), String(b.imagem).trim(), String(b.categoria).trim(), Number(b.valor_mensal), String(b.cobertura_destaque).trim(), req.params.id]);
  if (!rows.length) return reply.code(404).send({ erro: 'Seguro não encontrado.' });
  return paraJson(rows[0]);
});

app.delete('/api/seguros/:id', async (req, reply) => {
  if (!exigeBanco(reply)) return;
  if (!idValido(req.params.id)) return reply.code(400).send({ erro: 'Identificador inválido.' });
  const { rowCount } = await pool.query('DELETE FROM catalogo_seguros WHERE id = $1', [req.params.id]);
  if (!rowCount) return reply.code(404).send({ erro: 'Seguro não encontrado.' });
  return reply.code(204).send();
});

app.get('/api/categorias', async (req, reply) => {
  if (!exigeBanco(reply)) return;
  const { rows } = await pool.query('SELECT DISTINCT categoria FROM catalogo_seguros ORDER BY categoria');
  return rows.map((r) => r.categoria);
});

app.setErrorHandler((err, req, reply) => {
  req.log.error(err);
  reply.code(err.statusCode && err.statusCode < 500 ? err.statusCode : 500)
    .send({ erro: err.statusCode && err.statusCode < 500 ? 'Requisição inválida.' : 'Erro interno do servidor.' });
});

console.log(`Iniciando API do catálogo ${SEGURADORA} (prefixo de banco: ${P})`);
app.listen({ host: '0.0.0.0', port: Number(process.env.PORT || 8080) })
  .then(() => { iniciarBanco(); })
  .catch((err) => { console.error(err); process.exit(1); });
