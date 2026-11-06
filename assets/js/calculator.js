(() => {
  function initResearchCalculator() {
    const root = document.getElementById("calculadora");
    if (!root || root.dataset.calculatorReady === "true") return;
    const productInput = root.querySelector("#calcProductAmount");
    const liquidInput = root.querySelector("#calcWaterVolume");
    const referenceInput = root.querySelector("#calcDoseAmount");
    const unitSelect = root.querySelector("#calcDoseUnit");
    if (!productInput || !liquidInput || !referenceInput || !unitSelect) return;
    root.dataset.calculatorReady = "true";

    const get = id => root.querySelector("#" + id);
    const format = (value, digits = 6) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(value);
    const standardAmounts = [0.5, 1, 2, 5, 10];

    function syncPresetVisibility() {
      const unit = unitSelect.value;
      root.querySelectorAll(".calc-presets[data-target='calcDoseAmount']").forEach(group => {
        const visible = group.dataset.unit === unit;
        group.hidden = !visible;
        if (visible) group.querySelectorAll("button").forEach(button => {
          button.classList.toggle("is-active", referenceInput.value !== "" && Number(button.dataset.value) === Number(referenceInput.value));
        });
      });
      referenceInput.placeholder = unit === "mcg" ? "Informe em microgramas" : "Informe em mg";
    }

    function update() {
      const product = Number(productInput.value);
      const liquid = Number(liquidInput.value);
      const referenceEntered = Number(referenceInput.value);
      const referenceMg = unitSelect.value === "mcg" ? referenceEntered / 1000 : referenceEntered;
      const validProduct = productInput.value !== "" && Number.isFinite(product) && product > 0;
      const validLiquid = liquidInput.value !== "" && Number.isFinite(liquid) && liquid > 0;
      const validReference = referenceInput.value !== "" && Number.isFinite(referenceEntered) && referenceEntered > 0;
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
        calculatedVolume = referenceMg / mgMl;
        volumeResult.textContent = format(calculatedVolume) + " mL";
        microliters.textContent = format(calculatedVolume * 1000, 3) + " µL";
      } else {
        volumeResult.textContent = "—";
        microliters.textContent = "Digite ou selecione uma quantidade de referência.";
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

    root.querySelectorAll(".calc-presets[data-target='calcProductAmount'] button, .calc-presets[data-target='calcWaterVolume'] button").forEach(button => {
      button.addEventListener("click", () => {
        const group = button.closest(".calc-presets");
        const target = root.querySelector("#" + group.dataset.target);
        if (!target) return;
        target.value = button.dataset.value;
        group.querySelectorAll("button").forEach(item => item.classList.toggle("is-active", item === button));
        update();
      });
    });

    root.querySelectorAll(".calc-presets[data-target='calcDoseAmount'] button").forEach(button => {
      button.addEventListener("click", () => {
        const group = button.closest(".calc-presets");
        unitSelect.value = group.dataset.unit;
        referenceInput.value = button.dataset.value;
        syncPresetVisibility();
        update();
      });
    });

    [productInput, liquidInput, referenceInput].forEach(input => {
      input.addEventListener("input", () => {
        if (input === referenceInput) syncPresetVisibility();
        else {
          const group = root.querySelector('.calc-presets[data-target="' + input.id + '"]');
          if (group) group.querySelectorAll("button").forEach(button => {
            button.classList.toggle("is-active", input.value !== "" && Number(button.dataset.value) === Number(input.value));
          });
        }
        update();
      });
      input.addEventListener("change", update);
    });
    unitSelect.addEventListener("change", () => {
      referenceInput.value = "";
      syncPresetVisibility();
      update();
    });
    syncPresetVisibility();
    update();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initResearchCalculator, { once: true });
  else initResearchCalculator();
})();
