/**
 * Utilitário de Cobrança Ativa via WhatsApp (S08)
 *
 * Gera links "clique para conversar" (https://wa.me/<numero>?text=<mensagem>) com a mensagem
 * de cobrança ou de recibo já preenchida. Nada é enviado automaticamente: o app só abre o
 * WhatsApp com o texto pronto e o lojista decide se envia.
 */
import { limparNaoNumericos } from './validators';

const formatarMoeda = (v) =>
  `R$ ${Number(v || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;

/**
 * Normaliza o telefone para o formato internacional exigido pelo wa.me (55 + DDD + número).
 * Aceita "(86) 99988-7766", "86999887766" ou "5586999887766".
 * @returns {string|null} número só com dígitos ou null se inválido
 */
export function normalizarTelefoneWhatsApp(telefone) {
  let digitos = limparNaoNumericos(telefone || '');
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) {
    digitos = digitos.substring(2);
  }
  if (digitos.length !== 10 && digitos.length !== 11) return null;
  if (digitos.startsWith('0')) return null;
  return `55${digitos}`;
}

/** Primeiro nome do cliente para uma saudação mais pessoal. */
function primeiroNome(nome) {
  return String(nome || '').trim().split(/\s+/)[0] || 'cliente';
}

/**
 * Monta a mensagem de cobrança amigável da caderneta de fiado.
 * @param {{ nomeCliente: string, saldoDevedor: number, nomeLoja?: string, diasEmAberto?: number|null }} dados
 */
export function montarMensagemCobranca({ nomeCliente, saldoDevedor, nomeLoja = null, diasEmAberto = null }) {
  const apresentacao = nomeLoja ? `Aqui é da ${nomeLoja}.` : 'Aqui é do seu mercado de confiança.';
  const linhas = [
    `Olá, ${primeiroNome(nomeCliente)}! Tudo bem?`,
    `${apresentacao} Passando para lembrar que há um saldo em aberto na sua caderneta de ${formatarMoeda(saldoDevedor)}.`,
  ];
  if (diasEmAberto != null && diasEmAberto > 0) {
    linhas.push(`O último pagamento/compra foi há ${diasEmAberto} dia(s).`);
  }
  linhas.push('Você pode pagar o valor total ou uma parte quando passar aqui — cada pagamento já libera seu limite de compras na hora.');
  linhas.push('Obrigado pela preferência!');
  return linhas.join('\n');
}

/**
 * Monta a mensagem de recibo de uma amortização (pagamento parcial ou total).
 * @param {{ nomeCliente: string, valorPago: number, saldoRestante: number, limiteDisponivel: number, nomeLoja?: string, dataPagamento?: string }} dados
 */
export function montarMensagemRecibo({ nomeCliente, valorPago, saldoRestante, limiteDisponivel, nomeLoja = null, dataPagamento = null }) {
  const data = dataPagamento ? new Date(dataPagamento).toLocaleDateString('pt-BR') : new Date().toLocaleDateString('pt-BR');
  const linhas = [
    `Olá, ${primeiroNome(nomeCliente)}! Recebemos seu pagamento de ${formatarMoeda(valorPago)} em ${data}.`,
    saldoRestante > 0
      ? `Saldo restante na caderneta: ${formatarMoeda(saldoRestante)}.`
      : 'Sua caderneta está quitada!',
    `Limite disponível para novas compras: ${formatarMoeda(limiteDisponivel)}.`,
    nomeLoja ? `Obrigado! — ${nomeLoja}` : 'Obrigado pela preferência!',
  ];
  return linhas.join('\n');
}

/**
 * Gera o link wa.me com a mensagem codificada.
 * @returns {string|null} link ou null se o telefone for inválido
 */
export function gerarLinkWhatsApp(telefone, mensagem) {
  const numero = normalizarTelefoneWhatsApp(telefone);
  if (!numero) return null;
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensagem || '')}`;
}
