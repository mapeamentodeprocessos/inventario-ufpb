/* =====================================================================
   Nome e textos do produto — troque aqui e vale para todas as telas.
   ===================================================================== */
window.PRODUTO = {
  nome: 'Levantamento Patrimonial',
  descricao: 'Levantamento, conferência e inventário patrimonial para organizações públicas e privadas.',
  contato: 'gestaopatrimonialpb@gmail.com'
};
(function(){
  function aplicar(){
    document.querySelectorAll('[data-marca="nome"]').forEach(function(e){ e.textContent = window.PRODUTO.nome; });
    document.querySelectorAll('[data-marca="contato"]').forEach(function(e){ e.textContent = window.PRODUTO.contato; });
    if(document.title.indexOf('{produto}') >= 0) document.title = document.title.replace('{produto}', window.PRODUTO.nome);
  }
  if(document.readyState !== 'loading') aplicar(); else document.addEventListener('DOMContentLoaded', aplicar);
})();
