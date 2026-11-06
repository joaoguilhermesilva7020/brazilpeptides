(() => {
  function initResearchCalculator() {
    const root = document.getElementById("calculadora");
    if (!root || root.dataset.calculatorReady === "true") return;
    const productInput = root.querySelector("#calcProductAmount");
    const liquidInput = root.querySelector("#calcWaterVolume");
    const referenceInput = root.querySelector("#calcDoseAmount");
    if (!productInput || !liquidInput || !referenceInput) return;
    root.dataset.calculatorReady = "true";

    const get = id => root.querySelector("#" + id);
    const format = (value, digits = 6) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(value);
    const standardAmounts = [0.5, 1, 2, 5, 10];

    function update() {
      const product = Number(productInput.value);
      const liquid = Number(liquidInput.value);
      const reference = Number(referenceInput.value);
      const validProduct = productInput.value !== "" && Number.isFinite(product) && product > 0;
      const validLiquid = liquidInput.value !== "" && Number.isFinite(liquid) && liquid > 0;
      const validReference = referenceInput.value !== "" && Number.isFinite(reference) && reference > 0;
      const concentration = get("calcConcentrationResult");
      const concentrationDetail = get("calcConverted");
      const volumeResult = get("calcDoseVolumeResult");
      const microliters = get("calcDoseMicroliters");
      const rows = get("calcReferenceRows");
      const rulerValue = get("calcRulerValue");
      const rulerFill = get("calcRulerFill");
      const rulerCaption = get("calcRulerCaption");

      if (!validProduct || !validLiquid) {
        concentration.textContent = "—";
        concentrationDetail.textContent = "Informe valores positivos para a quantidade total e o volume.";
        volumeResult.textContent = "—";
        microliters.textContent = "A conversão ficará disponível após calcular a concentração.";
        rows.innerHTML = '<tr><td colspan="2">Informe a quantidade total e o volume de líquido.</td></tr>';
        rulerValue.textContent = "—";
        rulerFill.style.width = "0%";
        rulerCaption.textContent = "Selecione os valores para visualizar a equivalência matemática.";
        return;
      }

      const mgMl = product / liquid;
      concentration.textContent = format(mgMl) + " mg/mL";
      concentrationDetail.textContent = format(mgMl * 1000) + " mcg/mL";
      let calculatedVolume = null;
      if (validReference) {
        calculatedVolume = reference / mgMl;
        volumeResult.textContent = format(calculatedVolume) + " mL";
        microliters.textContent = format(calculatedVolume * 1000, 3) + " µL";
      } else {
        volumeResult.textContent = "—";
        microliters.textContent = "Digite ou selecione uma quantidade de referência em mg.";
      }

      if (calculatedVolume !== null && Number.isFinite(calculatedVolume)) {
        const percent = calculatedVolume / liquid * 100;
        rulerValue.textContent = format(calculatedVolume) + " mL";
        rulerFill.style.width = Math.max(0, Math.min(100, percent)) + "%";
        rulerCaption.textContent = percent > 100
          ? "O volume calculado ultrapassa o volume total informado (" + format(percent, 2) + "%). A barra é limitada a 100%."
          : format(percent, 2) + "% do volume total informado (escala visual proporcional).";
      } else {
        rulerValue.textContent = "—";
        rulerFill.style.width = "0%";
        rulerCaption.textContent = "Selecione uma quantidade de referência para atualizar a escala.";
      }

      rows.innerHTML = standardAmounts.map(amount => {
        const ml = amount / mgMl;
        return "<tr><td>" + format(amount) + " mg</td><td>" + format(ml) + " mL <span>(" + format(ml * 1000, 3) + " µL)</span></td></tr>";
      }).join("");
    }

    root.querySelectorAll(".calc-presets button").forEach(button => {
      button.addEventListener("click", () => {
        const group = button.closest(".calc-presets");
        const target = group && root.querySelector("#" + group.dataset.target);
        if (!target) return;
        target.value = button.dataset.value;
        group.querySelectorAll("button").forEach(item => item.classList.toggle("is-active", item === button));
        target.dispatchEvent(new Event("input", { bubbles: true }));
        update();
      });
    });

    [productInput, liquidInput, referenceInput].forEach(input => {
      input.addEventListener("input", () => {
        const group = root.querySelector('.calc-presets[data-target="' + input.id + '"]');
        if (group) group.querySelectorAll("button").forEach(button => {
          button.classList.toggle("is-active", input.value !== "" && Number(button.dataset.value) === Number(input.value));
        });
        update();
      });
      input.addEventListener("change", update);
    });
    update();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initResearchCalculator, { once: true });
  else initResearchCalculator();
})();
