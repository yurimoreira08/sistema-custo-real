/**
 * Utilitários de Validação de Documentos e Contatos
 * Validação de CPF, CNPJ e Telefone
 */

/**
 * Remove qualquer caractere não numérico de uma string
 */
export function limparNaoNumericos(val) {
  if (!val) return '';
  return String(val).replace(/\D/g, '');
}

/**
 * Valida se um CPF é matematicamente válido pelos 2 dígitos verificadores (módulo 11)
 */
export function validarCPF(cpf) {
  const limpo = limparNaoNumericos(cpf);
  if (limpo.length !== 11) return false;

  // Rejeita sequências de números iguais conhecidas (ex: 11111111111)
  if (/^(\d)\1{10}$/.test(limpo)) return false;

  // Primeiro dígito verificador
  let soma = 0;
  for (let i = 0; i < 9; i++) {
    soma += parseInt(limpo.charAt(i), 10) * (10 - i);
  }
  let resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(limpo.charAt(9), 10)) return false;

  // Segundo dígito verificador
  soma = 0;
  for (let i = 0; i < 10; i++) {
    soma += parseInt(limpo.charAt(i), 10) * (11 - i);
  }
  resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(limpo.charAt(10), 10)) return false;

  return true;
}

/**
 * Valida se um CNPJ é matematicamente válido pelos 2 dígitos verificadores (módulo 11)
 */
export function validarCNPJ(cnpj) {
  const limpo = limparNaoNumericos(cnpj);
  if (limpo.length !== 14) return false;

  // Rejeita sequências de números iguais
  if (/^(\d)\1{13}$/.test(limpo)) return false;

  // Primeiro dígito
  let tamanho = 12;
  let numeros = limpo.substring(0, tamanho);
  const digitos = limpo.substring(tamanho);
  let soma = 0;
  let pos = tamanho - 7;
  for (let i = tamanho; i >= 1; i--) {
    soma += parseInt(numeros.charAt(tamanho - i), 10) * pos--;
    if (pos < 2) pos = 9;
  }
  let resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
  if (resultado !== parseInt(digitos.charAt(0), 10)) return false;

  // Segundo dígito
  tamanho = 13;
  numeros = limpo.substring(0, tamanho);
  soma = 0;
  pos = tamanho - 7;
  for (let i = tamanho; i >= 1; i--) {
    soma += parseInt(numeros.charAt(tamanho - i), 10) * pos--;
    if (pos < 2) pos = 9;
  }
  resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
  if (resultado !== parseInt(digitos.charAt(1), 10)) return false;

  return true;
}

/**
 * Valida se uma string é um documento válido (CPF de 11 dígitos ou CNPJ de 14 dígitos)
 */
export function validarDocumento(doc) {
  if (!doc) return { valido: false, tipo: null, limpo: '', mensagem: 'Documento não informado.' };
  const limpo = limparNaoNumericos(doc);

  if (limpo.length === 11) {
    const valido = validarCPF(limpo);
    return {
      valido,
      tipo: 'CPF',
      limpo,
      mensagem: valido ? 'CPF válido.' : 'CPF inválido (dígito verificador incorreto).'
    };
  }

  if (limpo.length === 14) {
    const valido = validarCNPJ(limpo);
    return {
      valido,
      tipo: 'CNPJ',
      limpo,
      mensagem: valido ? 'CNPJ válido.' : 'CNPJ inválido (dígito verificador incorreto).'
    };
  }

  return {
    valido: false,
    tipo: null,
    limpo,
    mensagem: 'Documento deve conter 11 dígitos (CPF) ou 14 dígitos (CNPJ).'
  };
}

/**
 * Valida telefone brasileiro (DDD com 2 dígitos + 8 ou 9 dígitos do número)
 */
export function validarTelefone(tel) {
  if (!tel) return { valido: false, limpo: '', mensagem: 'Telefone não informado.' };
  const limpo = limparNaoNumericos(tel);

  // Formato: 10 dígitos (fixo ex: 8632321234) ou 11 dígitos (celular ex: 86999887766)
  if (limpo.length !== 10 && limpo.length !== 11) {
    return {
      valido: false,
      limpo,
      mensagem: 'Telefone deve conter DDD + número (10 ou 11 dígitos).'
    };
  }

  // DDD não pode começar com 0
  if (limpo.startsWith('0')) {
    return {
      valido: false,
      limpo,
      mensagem: 'DDD não pode iniciar com zero.'
    };
  }

  // Celulares de 11 dígitos no Brasil iniciam com 9 após o DDD
  if (limpo.length === 11 && limpo.charAt(2) !== '9') {
    return {
      valido: false,
      limpo,
      mensagem: 'Celulares de 11 dígitos devem conter o dígito 9 após o DDD.'
    };
  }

  return {
    valido: true,
    limpo,
    mensagem: 'Telefone válido.'
  };
}

/**
 * Formata CPF ou CNPJ com pontuação oficial
 */
export function formatarDocumento(doc) {
  const limpo = limparNaoNumericos(doc);
  if (limpo.length === 11) {
    return limpo.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  if (limpo.length === 14) {
    return limpo.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }
  return doc || '';
}

/**
 * Formata telefone brasileiro com parênteses e traço
 */
export function formatarTelefone(tel) {
  const limpo = limparNaoNumericos(tel);
  if (limpo.length === 10) {
    return limpo.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  }
  if (limpo.length === 11) {
    return limpo.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  }
  return tel || '';
}

