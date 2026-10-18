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

/* =====================================================================
   Tipos de levantamento patrimonial (finalidade da campanha).
   Usados no app de campo e no painel de gestão.
   ===================================================================== */
window.TIPOS_LEVANTAMENTO = [
  { nome: 'Anual', desc: 'Inventário de todos os bens no encerramento do exercício, para conferir a contabilidade.' },
  { nome: 'Inicial', desc: 'Primeiro inventário de uma unidade recém-criada ou da implantação do controle patrimonial.' },
  { nome: 'Transferência de responsabilidade', desc: 'Na troca do responsável ou dirigente da unidade: o que sai passa os bens a quem entra.' },
  { nome: 'Extinção ou transformação', desc: 'Quando a unidade é extinta, fundida, desmembrada ou muda de estrutura.' },
  { nome: 'Eventual / extraordinário', desc: 'A qualquer momento, por iniciativa da gestão ou por suspeita de irregularidade.' },
  { nome: 'Semestral / periódico', desc: 'Conferências regulares ao longo do ano, além do anual.' },
  { nome: 'Conferência por amostragem', desc: 'Verificação de parte dos bens, escolhidos por sorteio ou por risco.' },
  { nome: 'Auditoria / conformidade', desc: 'Para atender auditoria, controle interno ou órgão de controle.' },
  { nome: 'Desfazimento', desc: 'Identificação e classificação de bens ociosos, antieconômicos ou inservíveis para baixa, doação ou leilão.' },
  { nome: 'Mudança de endereço', desc: 'Antes e depois de mudança de prédio, sala ou reorganização física.' },
  { nome: 'Tombamento / regularização', desc: 'Para registrar e plaquetar bens que ainda não têm número de patrimônio.' },
  { nome: 'Localização de bens', desc: 'Busca específica de bens não localizados em levantamentos anteriores.' }
];
