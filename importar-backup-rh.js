// Uso: node importar-backup-rh.js backup_checklist_RH_29_07.json
// Roda esse script DENTRO da pasta trok-api no servidor (mesma pasta do server.js).
// Ele lê o arquivo de backup, salva as fotos na pasta uploads/ e grava as
// auditorias direto no banco de dados (dados.db), sem precisar de login/token.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const [, , arquivoArg] = process.argv;
if (!arquivoArg) {
  console.log('Uso: node importar-backup-rh.js nome-do-arquivo.json');
  process.exit(1);
}

const caminhoArquivo = path.join(__dirname, arquivoArg);
if (!fs.existsSync(caminhoArquivo)) {
  console.log('Arquivo não encontrado:', caminhoArquivo);
  process.exit(1);
}

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new Database(path.join(__dirname, 'dados.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS auditorias (
    id TEXT PRIMARY KEY,
    dados TEXT NOT NULL,
    atualizado_em TEXT
  );
`);

function salvarFotoBase64(dataUrl, prefixo) {
  if (!dataUrl || !dataUrl.startsWith('data:')) return dataUrl; // já é uma URL, ou vazio
  const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) return null;
  const ext = match[1].split('/')[1] || 'jpg';
  const buffer = Buffer.from(match[2], 'base64');
  const nomeArquivo = prefixo + '_' + crypto.randomBytes(6).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(UPLOADS_DIR, nomeArquivo), buffer);
  return '/uploads/' + nomeArquivo;
}

console.log('Lendo arquivo de backup...');
const conteudo = JSON.parse(fs.readFileSync(caminhoArquivo, 'utf-8'));
const visitas = Array.isArray(conteudo) ? conteudo : (conteudo.visits || []);

if (visitas.length === 0) {
  console.log('Nenhuma auditoria encontrada no arquivo.');
  process.exit(0);
}

let totalFotos = 0;
let importadas = 0;

const inserir = db.prepare(`
  INSERT INTO auditorias (id, dados, atualizado_em) VALUES (?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET dados = excluded.dados, atualizado_em = excluded.atualizado_em
`);

for (const v of visitas) {
  const prefixoBase = (v.id || ('au_' + Date.now())) + '_' + (v.loja || 'loja').replace(/[^a-zA-Z0-9]+/g, '');

  // Fotos gerais da visita
  const fotosGerais = (v.fotos || []).map((f, idx) => {
    const url = salvarFotoBase64(f.data, prefixoBase + '_geral_' + idx);
    if (url && url.startsWith('/uploads/')) totalFotos++;
    return { id: f.id, nome: f.nome, data: url };
  });

  // Fotos por item do checklist
  const itensComFotos = (v.itens || []).map((item, i) => {
    const fotosItem = (item.fotos || []).map((f, idx) => {
      const url = salvarFotoBase64(f.data, prefixoBase + '_item' + i + '_' + idx);
      if (url && url.startsWith('/uploads/')) totalFotos++;
      return { id: f.id, nome: f.nome, data: url };
    });
    return { ...item, fotos: fotosItem };
  });

  const assinatura = salvarFotoBase64(v.assinatura, prefixoBase + '_assin_gerente');
  const assinaturaAuditor = salvarFotoBase64(v.assinaturaAuditor, prefixoBase + '_assin_auditor');

  const dados = {
    loja: v.loja, data: v.data, responsavel: v.responsavel, gerente: v.gerente,
    status: v.status, obsGeral: v.obsGeral, reauditoriaDe: v.reauditoriaDe || null,
    itens: itensComFotos, fotos: fotosGerais,
    assinatura, assinaturaAuditor,
    nota: v.nota, notasCategoria: v.notasCategoria,
    criadoPor: 'importacao-backup',
    atualizadoEm: new Date().toISOString()
  };

  const id = v.id || ('au_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
  inserir.run(id, JSON.stringify(dados), dados.atualizadoEm);
  importadas++;
  console.log(`Importada: ${v.loja} (${v.data}) — nota ${v.nota}%`);
}

console.log('');
console.log(`Concluído! ${importadas} auditoria(s) importada(s), ${totalFotos} foto(s) salva(s) em uploads/.`);
