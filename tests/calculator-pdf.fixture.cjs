'use strict';
const C = require('../app/calculations.js');
const note = 'Subsídio técnico para análise e decisão do cliente e de seu responsável técnico. Resultados e recomendações indicativos; sem aprovação técnica, liberação operacional ou definição automática de intervalo de inspeção.';
function fixture(mode = 'pmta', changes = {}) {
  const inputs = mode === 'pmta' ? {
    tag: 'DEMO-PMTA-001', service: 'Ar comprimido - exemplo fictício', material: 'SA-516 Gr.70 - premissa fictícia',
    pmtaTask: 'pressure', designPressure: '10', operationPressure: '8', temperature: '80',
    diameter: '1500', length: '3500', shell: '12,7', headThickness: '12,7',
    corrosionAllowance: '3', efficiency: '0,85', stress: '138', head: 'elliptical',
    pmtaSource: 'Exemplo aritmético fictício: S = 138 MPa e E = 0,85; documentação de material, temperatura, juntas e código pendente.',
    ...changes
  } : {
    tag: 'DEMO-VR-001', service: 'Serviço constante - hipótese fictícia', material: 'Aço carbono - premissa fictícia',
    point: 'CML-DEMO-01 - posição 0°', current: '9,2', previous: '10', minimum: '6,4',
    previousDate: '2023-01-01', currentDate: '2025-01-01', asOf: '2026-10-10',
    previousOrigin: 'measured', minimumKind: 'required', minimumSource: 'DEMO-MIN-001 R.00 - espessura fictícia para testar a calculadora, sem origem normativa real.',
    measurementSource: 'DEMO-ME-001 R.00 - histórico fictício de medições; não representa inspeção física.',
    comparable: true, mechanism: 'uniform', ratePolicy: 'max', useInitial: false,
    assumptions: 'Cenário fictício: perda uniforme e condições de serviço constantes, para demonstração da projeção linear.',
    ...changes
  };
  return {
    version: '0.6.0', engineVersion: C.VERSION, createdAt: '2026-10-10T12:00:00.000Z', type: mode,
    inputs, results: mode === 'pmta' ? C.pmta(inputs) : C.life(inputs),
    sources: mode === 'pmta'
      ? [{ title: 'ASME VIII-1:2019, UG-27 e UG-32; aritmética de casco e elipsoidal 2:1 conferida. Verificação normativa integral pendente.' }]
      : [{ title: 'Método PI de projeção linear de espessura: perda / intervalo em dias corridos dividido por 365. Rastreabilidade documental na fonte informada pelo avaliador.' }],
    note,
    recommendations: mode === 'pmta'
      ? 'Completar a avaliação dos componentes, das juntas e dos demais carregamentos, com documentação do código e edição aplicáveis. A pressão de teste e a liberação operacional permanecem fora deste pré-cálculo.'
      : 'Conferir ponto, calibração, incerteza e superfície. Confirmar mecanismo de dano e espessura requerida com o responsável técnico antes de definir inspeção ou recomendação de operação.'
  };
}
function metadata(mode = 'pmta') {
  return {
    reportNumber: mode === 'pmta' ? 'DEMO-PI-PMTA-001' : 'DEMO-PI-VR-001', revision: '00', company: 'EMPRESA CLIENTE FICTÍCIA - DEMONSTRAÇÃO',
    notes: 'Exemplo local com dados fictícios, elaborado para testar a apresentação do memorial. Não associado a equipamento real.', fictitious: true,
    signatures: {
      plh: { name: 'PLH FICTÍCIO - DEMONSTRAÇÃO', specialty: 'Engenharia mecânica - exemplo', registration: 'Não atribuído - DEMO' },
      company: { name: 'EMPRESA INSPETORA FICTÍCIA', cnpj: 'Não atribuído - DEMO' },
      inspector: { name: 'INSPETOR FICTÍCIO - DEMONSTRAÇÃO', qualification: 'Medição de espessura - exemplo', registration: 'Não atribuído - DEMO' }
    }
  };
}
module.exports = { fixture, metadata };
