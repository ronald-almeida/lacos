export const product = Object.freeze({
  id: 'combo-4-em-1',
  name: 'COMBO 4 EM 1 BLACK 25',
  price: 9700,
});

export const bumps = Object.freeze([
  Object.freeze({ id: 'guia-atendimento', name: 'Guia de Atendimento ao Cliente', price: 1990 }),
  Object.freeze({ id: 'guia-embalagens', name: 'Guia Prático de Embalagens Criativas', price: 990 }),
]);

export function orderItems(ids) {
  if (!Array.isArray(ids) || ids.length > bumps.length || new Set(ids).size !== ids.length ||
      ids.some(id => !bumps.some(item => item.id === id))) {
    throw new Error('Selecione apenas as ofertas disponíveis.');
  }
  return [product, ...bumps.filter(item => ids.includes(item.id))];
}

export function whatsappLink(number, message) {
  if (!/^\d{10,15}$/.test(number || '')) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}
