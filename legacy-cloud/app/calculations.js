(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.IntegrityCalc = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = '0.2.0';
  const DAY = 86400000;
  class InputError extends Error {}
  function number(value, label, allowZero = false) {
    if (value === null || value === undefined || String(value).trim() === '') throw new InputError(`Informe ${label}.`);
    // Accept Brazilian decimal commas, but reject thousands separators / ambiguous input.
    const str = String(value).trim();
    if (!/^[-+]?\d+(?:[.,]\d+)?$/.test(str)) throw new InputError(`${label}: informe um número sem separador de milhar.`);
    const n = Number(str.replace(',', '.'));
    if (!Number.isFinite(n) || (allowZero ? n < 0 : n <= 0)) throw new InputError(`${label}: valor ${allowZero ? 'não negativo' : 'maior que zero'} necessário.`);
    return n;
  }
  function date(value, label) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) throw new InputError(`Informe ${label} completa.`);
    const ms = Date.parse(`${value}T00:00:00Z`);
    if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value || value < '1900-01-01') throw new InputError(`${label}: data inválida.`);
    return ms;
  }
  function yearsBetween(before, after, label) {
    const days = (date(after, 'a data atual') - date(before, label)) / DAY;
    if (days <= 0) throw new InputError('A data atual deve ser posterior às datas do histórico.');
    return { days, years: days / 365 };
  }
  function choice(value, allowed, label) {
    if (!allowed.includes(value)) throw new InputError(`Selecione ${label}.`);
    return value;
  }
  function requiredText(value, label) {
    if (typeof value !== 'string' || !value.trim()) throw new InputError(`Informe ${label}.`);
    return value.trim();
  }
  function assertArithmetic(values, positive = false) {
    if (values.some(value => value !== null && (!Number.isFinite(value) || (positive && value <= 0)))) {
      throw new InputError('Resultado fora da faixa numerica representavel. Revise unidades e escala dos dados.');
    }
  }
  function corrosionRate(loss, years) {
    const rate = loss / years;
    assertArithmetic([loss, rate]);
    if (loss !== 0 && rate === 0) throw new InputError('Taxa fora da faixa numerica representavel. Revise unidades e escala dos dados.');
    return rate;
  }
  // Use exact declared decimals only for domain decisions. Formula results stay
  // IEEE-754 numbers; no engineering tolerance or rounding band is introduced.
  function exactDecimal(value) {
    const text = String(value).trim().replace(',', '.');
    const sign = text.startsWith('-') ? -1n : 1n;
    const [whole, rawFraction = ''] = text.replace(/^[-+]/, '').split('.');
    const fraction = rawFraction.replace(/0+$/, '');
    return { units: sign * BigInt(whole + fraction), scale: fraction.length };
  }
  function alignedDecimals(left, right) {
    const scale = Math.max(left.scale, right.scale);
    return { left: left.units * 10n ** BigInt(scale - left.scale),
      right: right.units * 10n ** BigInt(scale - right.scale), scale };
  }
  function decimalSubtract(left, right) {
    const values = alignedDecimals(left, right);
    return { units: values.left - values.right, scale: values.scale };
  }
  function decimalTimes(left, right) {
    return { units: left.units * right.units, scale: left.scale + right.scale };
  }
  function decimalScale(value, multiplier) { return { units: value.units * multiplier, scale: value.scale }; }
  function decimalCompare(left, right) {
    const values = alignedDecimals(left, right);
    return values.left < values.right ? -1 : values.left > values.right ? 1 : 0;
  }
  function life(input) {
    const current = number(input.current, 'a espessura atual');
    const previous = number(input.previous, 'a espessura anterior');
    const minimum = number(input.minimum, 'a espessura mínima de referência');
    const origin = choice(input.previousOrigin, ['measured', 'nominal'], 'a origem da espessura anterior');
    const minimumKind = choice(input.minimumKind, ['required', 'alert', 'reference'], 'a natureza da espessura mínima');
    const mechanism = choice(input.mechanism, ['uniform', 'localized', 'unknown'], 'o mecanismo de perda');
    const policy = choice(input.ratePolicy || 'max', ['max', 'short', 'long'], 'o critério da taxa');
    const source = requiredText(input.minimumSource, 'a fonte da espessura mínima');
    const point = requiredText(input.point, 'o ponto / componente avaliado');
    if (input.comparable !== true) throw new InputError('Confirme a correspondência do ponto e das condições de serviço antes de calcular.');
    const interval = yearsBetween(input.previousDate, input.currentDate, 'a data anterior');
    const asOf = input.asOf || new Date().toISOString().slice(0, 10);
    if (date(input.currentDate, 'a data atual') > date(asOf, 'a data da avaliação')) throw new InputError('A medição atual não pode ter data futura.');
    const shortRate = corrosionRate(previous - current, interval.years);
    let longRate = null, longInterval = null, initial = null, initialOrigin = null;
    if (input.useInitial === true) {
      initial = number(input.initial, 'a espessura inicial');
      initialOrigin = choice(input.initialOrigin, ['measured', 'nominal'], 'a origem da espessura inicial');
      longInterval = yearsBetween(input.initialDate, input.currentDate, 'a data inicial');
      if (date(input.initialDate, 'a data inicial') >= date(input.previousDate, 'a data anterior')) throw new InputError('Para comparar longo e curto prazo, a data inicial deve ser anterior à medição anterior.');
      longRate = corrosionRate(initial - current, longInterval.years);
    }
    if (policy === 'long' && longRate === null) throw new InputError('Preencha o histórico inicial para selecionar a taxa de longo prazo.');
    const justification = policy === 'max' ? '' : requiredText(input.justification, 'a justificativa para selecionar uma taxa específica');
    const adoptedRate = policy === 'short' ? shortRate : policy === 'long' ? longRate : Math.max(shortRate, longRate === null ? -Infinity : longRate);
    const adoptedBasis = policy === 'short' || longRate === null || (policy === 'max' && shortRate >= longRate) ? 'short' : 'long';
    const margin = current - minimum;
    const warnings = [];
    const hypothesis = origin === 'nominal' || initialOrigin === 'nominal' || minimumKind === 'reference';
    if (origin === 'nominal' || initialOrigin === 'nominal') warnings.push('Espessura nominal usada como hipótese histórica. A taxa estimada inclui possíveis tolerâncias de fabricação e não equivale a duas medições.');
    if (minimumKind === 'reference') warnings.push('A referência mínima não foi classificada como requerida ou de alerta. O prazo calculado é somente um cenário.');
    if (minimumKind === 'alert') warnings.push('Este prazo é até a espessura de alerta, não a vida remanescente até a espessura requerida.');
    if (policy === 'max') warnings.push('Adotada a maior taxa disponível para esta estimativa. A escolha da taxa representativa do processo exige avaliação técnica.');
    if (policy !== 'max' && adoptedRate < Math.max(shortRate, longRate === null ? shortRate : longRate)) warnings.push('A taxa selecionada é menor que outra taxa disponível; a justificativa deve ser revisada.');
    const thicknessIncrease = shortRate < 0 || (longRate !== null && longRate < 0) || (initial !== null && previous > initial);
    let status = 'estimated', remainingYears = null;
    if (margin <= 0) {
      status = 'at_or_below_minimum'; remainingYears = 0;
      warnings.unshift('A espessura atual está no limite ou abaixo da referência informada. Encaminhar para avaliação técnica; não há margem de projeção.');
    } else if (thicknessIncrease) {
      status = 'inconsistent_history';
      warnings.unshift('Há aumento de espessura no histórico. Verifique ponto, calibração, incerteza, revestimento ou reparo. Projeção suspensa.');
    } else if (mechanism !== 'uniform') {
      status = 'mechanism_review';
      warnings.unshift('A projeção linear requer perda uniforme representativa e condições de serviço constantes. Dano localizado ou mecanismo não definido exige avaliação específica.');
    } else if (adoptedRate <= 0) {
      status = 'no_positive_rate';
      warnings.unshift('Não foi observada taxa positiva no histórico selecionado. Vida remanescente indeterminada; não significa vida infinita.');
    } else {
      remainingYears = margin / adoptedRate;
      if (hypothesis) status = 'hypothesis';
    }
    const shortLife = shortRate > 0 && !thicknessIncrease && mechanism === 'uniform' ? Math.max(0, margin) / shortRate : null;
    const longLife = longRate !== null && longRate > 0 && !thicknessIncrease && mechanism === 'uniform' ? Math.max(0, margin) / longRate : null;
    const lossPercent = (previous - current) / previous * 100;
    const remainingMonths = remainingYears === null ? null : remainingYears * 12;
    assertArithmetic([lossPercent, margin, adoptedRate, shortLife, longLife, remainingYears, remainingMonths]);
    if (margin > 0) assertArithmetic([shortLife, longLife, remainingYears, remainingMonths], true);
    return {
      version: VERSION, mode: 'life', status, point, minimumKind, minimumSource: source,
      current, previous, minimum, interval, longInterval, loss: previous - current,
      lossPercent, margin,
      shortRate, longRate, adoptedRate, adoptedBasis, policy, justification,
      shortLife, longLife, remainingYears, remainingMonths,
      hypothesis, warnings,
      model: 'Perda linear de espessura; dias corridos / 365; meses = anos × 12. Prazo contado desde a medição atual, sem definir intervalo de inspeção.'
    };
  }
  // Arithmetic reproduction of the supplied spreadsheet screenshots. This is
  // deliberately limited to a cylinder and two identical 2:1 elliptical heads.
  // It is not a complete ASME VIII assessment or a vessel MAWP determination.
  function pmta(input) {
    const constructionCode = input.constructionCode === undefined ? null : assertPmtaCode(input.constructionCode);
    const pressure = number(input.designPressure, 'a pressão de projeto') / 10;
    const operationBar = number(input.operationPressure, 'a pressão de operação', true);
    const operation = operationBar / 10;
    if (operationBar > 0) assertArithmetic([operation], true);
    if (operation > pressure) throw new InputError('A pressão de operação excede a pressão de projeto informada. Revise os dados.');
    if (input.head !== 'elliptical') throw new InputError('O pré-cálculo disponível cobre somente tampo elipsoidal 2:1. Esta geometria ainda não foi implementada.');
    const diameter = number(input.diameter, 'o diâmetro interno');
    const length = number(input.length, 'o comprimento cilíndrico');
    const shell = number(input.shell, 'a espessura nominal do casco');
    const head = number(input.headThickness, 'a espessura nominal do tampo');
    const ca = number(input.corrosionAllowance, 'a sobreespessura de corrosão', true);
    const efficiency = number(input.efficiency, 'a eficiência da junta');
    const stress = number(input.stress, 'a tensão admissível');
    if (efficiency > 1) throw new InputError('A eficiência da junta deve ser menor ou igual a 1.');
    if (ca >= shell || ca >= head) throw new InputError('A sobreespessura deve ser menor que as espessuras nominais do casco e do tampo.');
    const radius = diameter / 2, se = stress * efficiency;
    const effectiveShell = shell - ca, effectiveHead = head - ca;
    // UG-32(c): equivalent crown radius for a 2:1 ellipsoidal head is L = 0.90D.
    // The trigger uses t_s/L, not t_s/D. The nominal-minus-CA input remains a
    // partial arithmetic premise; post-forming minimum thickness must be verified.
    const headCrownRadius = 0.9 * diameter;
    assertArithmetic([pressure, radius, se, effectiveShell, effectiveHead, headCrownRadius], true);
    const exactDiameter = exactDecimal(input.diameter), exactCA = exactDecimal(input.corrosionAllowance);
    const exactShell = decimalSubtract(exactDecimal(input.shell), exactCA);
    const exactHead = decimalSubtract(exactDecimal(input.headThickness), exactCA);
    const exactSE = decimalTimes(exactDecimal(input.stress), exactDecimal(input.efficiency));
    if (constructionCode && decimalCompare(decimalScale(exactHead, 5000n), decimalScale(exactDiameter, 9n)) < 0) throw new InputError('Tampo com t/L < 0,002 (L = 0,90D para elipsoidal 2:1): é necessária a verificação adicional do Appendix 1-4(f), ainda não implementada neste cálculo parcial.');
    if (decimalCompare(decimalScale(exactDecimal(input.designPressure), 100n), decimalScale(exactSE, 385n)) > 0 ||
        decimalCompare(decimalScale(exactShell, 4n), exactDiameter) > 0 ||
        decimalCompare(decimalScale(exactHead, 4n), exactDiameter) > 0) throw new InputError('Condição fora do domínio restrito deste pré-cálculo. Necessária avaliação pelo código aplicável.');
    const circumferential = pressure * radius / (se - 0.6 * pressure);
    const longitudinal = pressure * radius / (2 * se + 0.4 * pressure);
    const shellRequired = Math.max(circumferential, longitudinal) + ca;
    const headNet = pressure * diameter / (2 * se - 0.2 * pressure);
    const headRequired = headNet + ca;
    const shellCircPressure = se * effectiveShell / (radius + 0.6 * effectiveShell) * 10;
    const shellLongPressure = 2 * se * effectiveShell / (radius - 0.4 * effectiveShell) * 10;
    const shellPressure = Math.min(shellCircPressure, shellLongPressure);
    const headPressure = 2 * se * effectiveHead / (diameter + 0.2 * effectiveHead) * 10;
    const componentPressure = Math.min(shellPressure, headPressure);
    const cylinderVolume = Math.PI * (diameter / 1000) ** 2 / 4 * length / 1000;
    const oneHeadVolume = Math.PI * (diameter / 1000) ** 3 / 24;
    const volume = cylinderVolume + 2 * oneHeadVolume;
    const pressureMargin = componentPressure - pressure * 10;
    assertArithmetic([circumferential, longitudinal, shellRequired, headNet, headRequired,
      shellCircPressure, shellLongPressure, shellPressure, headPressure, componentPressure,
      cylinderVolume, oneHeadVolume, volume], true);
    assertArithmetic([pressureMargin]);
    return { version: VERSION, mode: 'pmta', status: 'partial', pressure, operation,
      ...(constructionCode ? { constructionCode, method: `ASME VIII-1:${constructionCode.edition}; UG-27(c)(1)/(2) e UG-32(c); cálculo parcial de pressão interna.` } : {}),
      circumferential, longitudinal, shellRequired, headNet, headRequired,
      effectiveShell, effectiveHead, shellCircPressure, shellLongPressure, shellPressure, headPressure, componentPressure,
      shellMeets: shell >= shellRequired, headMeets: head >= headRequired,
      pressureMargin,
      cylinderVolume, oneHeadVolume, volume,
      warnings: [
        'Resultado parcial de casco e tampos sob pressão interna. A PMTA do vaso permanece pendente da verificação dos demais componentes e carregamentos.',
        'Reprodução aritmética das imagens fornecidas. Edição ASME, tensão admissível na temperatura, eficiências de juntas e limites completos do código ainda devem ser validados.',
        'Usa espessuras nominais menos a sobreespessura informada; não avalia automaticamente espessuras medidas em serviço, tolerâncias ou redução por conformação.',
        'Diâmetro e raio são usados como informados. Confirmar a condição geométrica corroída e a referência da pressão, inclusive carga estática.',
        'Vácuo, bocais, flanges, suportes, NR-13 e pressão de teste continuam pendentes; este resultado não define a pressão de ensaio.'
      ]
    };
  }
  function assertPmtaCode(input) {
    const codes = typeof require === 'function' ? require('./construction-code.js') : globalThis.PiresConstructionCode;
    if (!codes) throw new InputError('O registro de códigos de construção não está disponível.');
    try {
      const code = codes.assertDiv1(input);
      if (!['2019', '2023'].includes(code.edition)) throw new InputError('Selecione uma edição conferida para este cálculo parcial da Divisão 1: 2019 ou 2023. Outras edições exigem conferência própria.');
      if (!code.source) throw new InputError('Informe a fonte documental do código e da edição utilizados.');
      return code;
    } catch (error) { throw new InputError(error.message); }
  }
  return { VERSION, InputError, life, pmta, yearsBetween, assertPmtaCode };
});
