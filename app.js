const YEARS = [2022, 2023, 2024, 2025, 2026];
const MAX_COMPARISONS = 3;

const elements = {
  fileProtocolWarning: document.querySelector("#file-protocol-warning"),
  form: document.querySelector("#search-form"),
  district: document.querySelector("#district"),
  neighborhood: document.querySelector("#neighborhood"),
  buildingType: document.querySelector("#building-type"),
  budget: document.querySelector("#budget"),
  budgetReadable: document.querySelector("#budget-readable"),
  analyzeButton: document.querySelector("#analyze-button"),
  status: document.querySelector("#status-message"),
  loading: document.querySelector("#loading-panel"),
  emptyState: document.querySelector("#empty-state"),
  results: document.querySelector("#results"),
  resultHeading: document.querySelector("#result-heading"),
  resultSubtitle: document.querySelector("#result-subtitle"),
  metricDeposit: document.querySelector("#metric-deposit"),
  metricDepositNote: document.querySelector("#metric-deposit-note"),
  metricArea: document.querySelector("#metric-area"),
  metricAreaPyeong: document.querySelector("#metric-area-pyeong"),
  metricChange: document.querySelector("#metric-change"),
  metricCount: document.querySelector("#metric-count"),
  insightText: document.querySelector("#insight-text"),
  yearlyTableBody: document.querySelector("#yearly-table-body"),
  addComparison: document.querySelector("#add-comparison"),
  comparisonSection: document.querySelector("#comparison-section"),
  comparisonList: document.querySelector("#comparison-list"),
  map: document.querySelector("#seoul-map"),
  mapYear: document.querySelector("#map-year"),
  mapStatus: document.querySelector("#map-status"),
  mapSelectionTitle: document.querySelector("#map-selection-title"),
  mapSelectionGuide: document.querySelector("#map-selection-guide"),
  mapDepositLabel: document.querySelector("#map-deposit-label"),
  mapDeposit: document.querySelector("#map-deposit"),
  mapAreaLabel: document.querySelector("#map-area-label"),
  mapArea: document.querySelector("#map-area"),
  mapCountLabel: document.querySelector("#map-count-label"),
  mapCount: document.querySelector("#map-count"),
  mapAnalyzeButton: document.querySelector("#map-analyze-button"),
};

let regions = [];
let currentAnalysis = null;
let comparisons = [];
let legalDongGeojson = null;
let regionByLegalDongCode = new Map();
let mapClickBound = false;

initialize();

async function initialize() {
  bindEvents();
  updateBudgetLabel();

  if (window.location.protocol === "file:") {
    showFileProtocolWarning();
    return;
  }

  try {
    const response = await fetch("data/regions.json");
    if (!response.ok) throw new Error("지역 목록을 불러오지 못했습니다.");

    regions = await response.json();
    regionByLegalDongCode = buildRegionIndex(regions);
    populateDistricts();
    loadLegalDongMap();
  } catch (error) {
    showStatus(error.message);
    elements.analyzeButton.disabled = true;
    elements.mapAnalyzeButton.disabled = true;
    elements.mapStatus.textContent = "지역 목록을 불러오지 못해 지도를 준비할 수 없습니다.";
  }
}

function showFileProtocolWarning() {
  elements.fileProtocolWarning.hidden = false;
  elements.district.innerHTML = '<option value="">로컬 실행 주소에서 불러옵니다</option>';
  elements.district.disabled = true;
  elements.neighborhood.innerHTML = '<option value="">로컬 실행 주소가 필요합니다</option>';
  elements.neighborhood.disabled = true;
  elements.analyzeButton.disabled = true;
  elements.mapAnalyzeButton.disabled = true;
  elements.mapSelectionTitle.textContent = "로컬 실행 주소가 필요합니다";
  elements.mapSelectionGuide.textContent =
    "위 안내의 ‘정상 실행 화면 열기’ 버튼을 누르면 지도와 전세 데이터를 이용할 수 있어요.";
  elements.mapStatus.textContent =
    "파일을 직접 연 상태에서는 지역 목록, 지도, 전세 데이터 API를 불러올 수 없습니다.";
  elements.map.textContent = "정상 실행 화면에서 서울 법정동 지도가 표시됩니다.";
  elements.map.classList.add("seoul-map--fallback");
  showStatus("HTML 파일 대신 http://127.0.0.1:4173/ 주소로 열어 주세요.");
}

async function loadLegalDongMap() {
  try {
    const response = await fetch("data/seoul-legal-dongs.geojson");
    if (!response.ok) throw new Error("법정동 경계를 불러오지 못했습니다.");

    const payload = await response.json();
    const features = Array.isArray(payload.features)
      ? payload.features.map(prepareMapFeature).filter(Boolean)
      : [];

    if (payload.type !== "FeatureCollection" || features.length < 400) {
      throw new Error("법정동 경계 형식을 확인할 수 없습니다.");
    }

    legalDongGeojson = { type: "FeatureCollection", features };
    elements.mapStatus.textContent = `${formatNumber(features.length, 0)}개 법정동 경계를 불러왔습니다. 지도는 현행 경계 기준입니다.`;
    await renderMap();
  } catch (error) {
    elements.mapStatus.textContent = `${error.message} 위 선택창을 이용해 분석할 수 있습니다.`;
    elements.map.textContent = "지도를 표시할 수 없습니다.";
    elements.map.classList.add("seoul-map--fallback");
  }
}

function buildRegionIndex(districts) {
  const index = new Map();

  districts.forEach((district) => {
    district.neighborhoods.forEach((neighborhood) => {
      const code = `${district.code}${neighborhood.code}`;
      index.set(code, {
        code,
        districtCode: district.code,
        districtName: district.name,
        neighborhoodCode: neighborhood.code,
        neighborhoodName: neighborhood.name,
      });
    });
  });

  return index;
}

function prepareMapFeature(feature) {
  const properties = feature?.properties ?? {};
  const code = normalizeLegalDongCode(
    properties.code ?? properties.EMD_CD ?? properties.emdCode,
  );
  const geometryType = feature?.geometry?.type;

  if (!code || !["Polygon", "MultiPolygon"].includes(geometryType)) return null;

  return {
    ...feature,
    id: code,
    properties: {
      ...properties,
      code,
      districtCode: properties.districtCode ?? code.slice(0, 5),
      name: properties.name ?? properties.EMD_NM ?? "법정동",
    },
  };
}

function normalizeLegalDongCode(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 8) return `${digits}00`;
  if (digits.length === 10) return digits;
  return null;
}

function bindEvents() {
  elements.form.addEventListener("submit", handleSubmit);
  elements.district.addEventListener("change", () => {
    populateNeighborhoods();
    renderMap();
  });
  elements.neighborhood.addEventListener("change", renderMap);
  elements.buildingType.addEventListener("change", renderMap);
  elements.mapYear.addEventListener("change", renderMap);
  elements.mapAnalyzeButton.addEventListener("click", () => {
    elements.form.requestSubmit();
  });
  elements.budget.addEventListener("input", () => {
    updateBudgetLabel();
    if (currentAnalysis) renderAnalysis();
    if (comparisons.length) renderComparisons();
    renderMap();
  });
  elements.addComparison.addEventListener("click", addCurrentComparison);
  window.addEventListener("resize", debounce(resizePlots, 180));
}

function populateDistricts() {
  elements.district.replaceChildren();

  regions.forEach((district) => {
    elements.district.append(createOption(district.code, district.name));
  });

  const defaultDistrict = regions.find((district) => district.name === "마포구") ?? regions[0];

  if (defaultDistrict) {
    elements.district.value = defaultDistrict.code;
    populateNeighborhoods();
    renderMap();
  }
}

function populateNeighborhoods() {
  const district = getSelectedDistrict();
  elements.neighborhood.replaceChildren();

  if (!district) {
    elements.neighborhood.append(createOption("", "자치구를 먼저 선택하세요"));
    elements.neighborhood.disabled = true;
    return;
  }

  district.neighborhoods.forEach((neighborhood) => {
    elements.neighborhood.append(createOption(neighborhood.code, neighborhood.name));
  });

  elements.neighborhood.disabled = false;
}

function createOption(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

async function renderMap() {
  const district = getSelectedDistrict();
  const neighborhood = getSelectedNeighborhood();
  const selectedCode = getSelectedLegalDongCode();

  updateMapSummary(district, neighborhood);

  if (!legalDongGeojson) return;

  if (!window.Plotly) {
    elements.mapStatus.textContent =
      "지도 도구를 불러오지 못했습니다. 위 선택창으로는 계속 분석할 수 있습니다.";
    elements.map.textContent = "지도 도구 로딩에 실패했습니다.";
    elements.map.classList.add("seoul-map--fallback");
    return;
  }

  const comparisonCodes = new Set(
    comparisons.map((item) => item.legalDongCode).filter(Boolean),
  );
  const locations = legalDongGeojson.features.map((feature) => feature.id);
  const hovertext = legalDongGeojson.features.map((feature) =>
    createMapHoverText(feature.id, feature.properties.name),
  );
  const baseValues = legalDongGeojson.features.map((feature) => {
    if (comparisonCodes.has(feature.id) && feature.id !== selectedCode) return 2;
    if (feature.id.startsWith(district?.code ?? "-----")) return 1;
    return 0;
  });
  const traces = [
    {
      type: "choropleth",
      geojson: legalDongGeojson,
      featureidkey: "properties.code",
      locations,
      z: baseValues,
      zmin: 0,
      zmax: 2,
      colorscale: [
        [0, "#f8fafc"],
        [0.5, "#fed7aa"],
        [1, "#0f766e"],
      ],
      showscale: false,
      hovertext,
      hovertemplate: "%{hovertext}<extra></extra>",
      marker: { line: { color: "#64748b", width: 0.75 } },
    },
  ];

  const selectedFeature = legalDongGeojson.features.find(
    (feature) => feature.id === selectedCode,
  );

  if (selectedFeature) {
    traces.push({
      type: "choropleth",
      geojson: { type: "FeatureCollection", features: [selectedFeature] },
      featureidkey: "properties.code",
      locations: [selectedCode],
      z: [1],
      colorscale: [
        [0, "#f26722"],
        [1, "#f26722"],
      ],
      showscale: false,
      hovertext: [createMapHoverText(selectedCode, selectedFeature.properties.name)],
      hovertemplate: "%{hovertext}<extra></extra>",
      marker: { line: { color: "#7c2d12", width: 2.8 } },
    });
  }

  try {
    await window.Plotly.react(
      elements.map,
      traces,
      {
        autosize: true,
        margin: { t: 6, r: 6, b: 6, l: 6 },
        paper_bgcolor: "#cbd5e1",
        plot_bgcolor: "#cbd5e1",
        showlegend: false,
        clickmode: "event+select",
        dragmode: false,
        geo: {
          fitbounds: "locations",
          projection: { type: "mercator" },
          bgcolor: "#cbd5e1",
          showframe: false,
          showcoastlines: false,
          showland: false,
          visible: true,
        },
        font: {
          family: 'Pretendard, "Noto Sans KR", sans-serif',
          color: "#46515e",
        },
        hoverlabel: {
          bgcolor: "#17202b",
          bordercolor: "#17202b",
          font: { color: "#ffffff" },
        },
      },
      {
        responsive: true,
        displayModeBar: false,
        scrollZoom: false,
        locale: "ko",
      },
    );

    bindMapClick();
  } catch {
    elements.mapStatus.textContent =
      "지도를 그리는 중 오류가 발생했습니다. 위 선택창을 이용해 분석해 주세요.";
  }
}

function bindMapClick() {
  if (mapClickBound || typeof elements.map.on !== "function") return;

  elements.map.on("plotly_click", (event) => {
    const code = normalizeLegalDongCode(event.points?.[0]?.location);
    if (code) selectNeighborhoodFromMap(code);
  });
  mapClickBound = true;
}

function selectNeighborhoodFromMap(code) {
  const region = regionByLegalDongCode.get(code);

  if (!region) {
    elements.mapStatus.textContent =
      "해당 법정동은 현재 전세 거래 선택 목록에 없습니다. 다른 동을 선택해 주세요.";
    return;
  }

  elements.district.value = region.districtCode;
  populateNeighborhoods();
  elements.neighborhood.value = region.neighborhoodCode;
  elements.mapStatus.textContent = `${region.districtName} ${region.neighborhoodName}을(를) 선택했습니다. ‘이 동네 5년 분석하기’를 눌러 결과를 확인해 보세요.`;
  renderMap();
}

function updateMapSummary(district, neighborhood) {
  const year = Number(elements.mapYear.value);
  const analysisMatches = doesAnalysisMatchSelection();
  const yearly = analysisMatches
    ? currentAnalysis.yearly.find((item) => item.year === year)
    : null;
  const estimatedArea = estimateArea(getBudget(), yearly?.averagePricePerM2);
  const title = district && neighborhood
    ? `${district.name} ${neighborhood.name}`
    : "법정동을 선택해 주세요";
  const yearLabel = year === 2026 ? "2026년 누적" : `${year}년`;

  elements.mapSelectionTitle.textContent = title;
  elements.mapDepositLabel.textContent = `${yearLabel} 평균 전세가`;
  elements.mapAreaLabel.textContent = `${yearLabel} 예상 가능 면적`;
  elements.mapCountLabel.textContent = `${yearLabel} 분석 거래`;

  if (!analysisMatches) {
    elements.mapSelectionGuide.textContent =
      "지도에서 동을 선택하거나 위 조건을 조정한 뒤 5년 분석을 실행해 주세요.";
    elements.mapDeposit.textContent = "분석 전";
    elements.mapArea.textContent = "분석 전";
    elements.mapCount.textContent = "분석 전";
  } else {
    elements.mapSelectionGuide.textContent = `${currentAnalysis.buildingTypeLabel} · 예산 ${formatMoney(getBudget())} · 접수연도 기준`;
    elements.mapDeposit.textContent = yearly?.averageDeposit
      ? formatMoney(yearly.averageDeposit)
      : "거래 0건";
    elements.mapArea.textContent = estimatedArea
      ? `${formatNumber(estimatedArea, 1)}㎡ · ${formatNumber(toPyeong(estimatedArea), 1)}평`
      : "계산 불가";
    elements.mapCount.textContent = yearly
      ? `${formatNumber(yearly.tradeCount, 0)}건`
      : "분석 전";
  }

  elements.map.setAttribute(
    "aria-label",
    analysisMatches
      ? `${year}년 ${title} ${currentAnalysis.buildingTypeLabel} 전세 분석 지도`
      : `${title}이(가) 선택된 서울 법정동 지도`,
  );
}

function createMapHoverText(code, fallbackName) {
  const region = regionByLegalDongCode.get(code);
  const districtName =
    region?.districtName ??
    regions.find((district) => district.code === code.slice(0, 5))?.name ??
    "서울";
  const neighborhoodName = region?.neighborhoodName ?? fallbackName ?? "법정동";
  const isSelected = code === getSelectedLegalDongCode();
  const year = Number(elements.mapYear.value);
  const yearly = isSelected && doesAnalysisMatchSelection()
    ? currentAnalysis.yearly.find((item) => item.year === year)
    : null;
  const estimatedArea = estimateArea(getBudget(), yearly?.averagePricePerM2);

  if (!isSelected) {
    return `<b>${districtName} ${neighborhoodName}</b><br>${region ? "클릭하여 선택" : "전세 거래 선택 목록 외 지역"}`;
  }

  if (!yearly) {
    return `<b>${districtName} ${neighborhoodName}</b><br>선택된 법정동 · 분석 전`;
  }

  const depositText = yearly.averageDeposit ? formatMoney(yearly.averageDeposit) : "거래 0건";
  const areaText = estimatedArea ? `${formatNumber(estimatedArea, 1)}㎡` : "계산 불가";
  return `<b>${year}년 ${districtName} ${neighborhoodName}</b><br>평균 전세가 ${depositText}<br>예상 면적 ${areaText}<br>거래 ${formatNumber(yearly.tradeCount, 0)}건`;
}

function doesAnalysisMatchSelection() {
  return Boolean(
    currentAnalysis &&
      currentAnalysis.cggCode === elements.district.value &&
      currentAnalysis.stdgCode === elements.neighborhood.value &&
      currentAnalysis.buildingType === elements.buildingType.value,
  );
}

function getSelectedLegalDongCode() {
  const district = getSelectedDistrict();
  const neighborhood = getSelectedNeighborhood();
  return district && neighborhood ? `${district.code}${neighborhood.code}` : null;
}

async function handleSubmit(event) {
  event.preventDefault();
  clearStatus();

  const district = getSelectedDistrict();
  const neighborhood = getSelectedNeighborhood();
  const budget = getBudget();

  if (!district || !neighborhood) {
    showStatus("자치구와 동을 선택해 주세요.");
    return;
  }

  if (!Number.isFinite(budget) || budget < 1000) {
    showStatus("전세 예산을 1,000만 원 이상 입력해 주세요.");
    return;
  }

  setLoading(true);

  try {
    const request = {
      cggCode: district.code,
      cggName: district.name,
      stdgCode: neighborhood.code,
      buildingType: elements.buildingType.value,
    };

    const yearly = await Promise.all(
      YEARS.map((year) => fetchYearSummary(year, request)),
    );

    currentAnalysis = {
      ...request,
      districtName: district.name,
      neighborhoodName: neighborhood.name,
      buildingTypeLabel:
        elements.buildingType.options[elements.buildingType.selectedIndex].text,
      yearly,
    };

    elements.emptyState.hidden = true;
    elements.results.hidden = false;
    renderAnalysis();
    window.requestAnimationFrame(resizePlots);
    elements.results.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    showStatus(error.message || "분석 중 오류가 발생했습니다.");
  } finally {
    setLoading(false);
  }
}

async function fetchYearSummary(year, request) {
  const query = new URLSearchParams({
    year: String(year),
    cggCode: request.cggCode,
    cggName: request.cggName,
    stdgCode: request.stdgCode,
    buildingType: request.buildingType,
  });

  let response;

  try {
    response = await fetch(`/api/rent?${query.toString()}`);
  } catch {
    if (window.location.protocol === "file:") {
      throw new Error(
        "HTML 파일을 직접 열면 데이터를 조회할 수 없습니다. http://127.0.0.1:4173/ 주소로 열어 주세요.",
      );
    }

    if (["localhost", "127.0.0.1"].includes(window.location.hostname)) {
      throw new Error(
        "로컬 데이터 서버에 연결하지 못했습니다. 미리보기 서버가 실행 중인지 확인해 주세요.",
      );
    }

    throw new Error(
      "데이터 서버에 연결하지 못했습니다. 잠시 후 다시 시도하거나 배포 상태를 확인해 주세요.",
    );
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || `${year}년 데이터를 불러오지 못했습니다.`);
  }

  return payload;
}

function renderAnalysis() {
  if (!currentAnalysis) return;

  const budget = getBudget();
  const yearly = currentAnalysis.yearly.map((item) => ({
    ...item,
    estimatedArea: estimateArea(budget, item.averagePricePerM2),
  }));
  const first = yearly.find((item) => item.year === 2022);
  const latest = yearly.find((item) => item.year === 2026);

  elements.resultHeading.textContent = `${currentAnalysis.districtName} ${currentAnalysis.neighborhoodName}`;
  elements.resultSubtitle.textContent = `${currentAnalysis.buildingTypeLabel} · 예산 ${formatMoney(budget)} · 접수연도 기준`;

  renderMetrics(first, latest, budget);
  renderInsight(first, latest, budget);
  renderCharts(yearly);
  renderYearlyTable(yearly);
  renderMap();

  elements.addComparison.disabled = !latest?.averagePricePerM2;
}

function renderMetrics(first, latest, budget) {
  const change = percentageChange(first?.estimatedArea, latest?.estimatedArea);

  elements.metricDeposit.textContent = latest?.averageDeposit
    ? formatMoney(latest.averageDeposit)
    : "거래 0건";
  elements.metricDepositNote.textContent = latest?.averagePricePerM2
    ? `평균 ${formatNumber(latest.averagePricePerM2, 1)}만 원/㎡`
    : "선택 조건에 맞는 전세 거래가 없습니다";
  elements.metricArea.textContent = latest?.estimatedArea
    ? `${formatNumber(latest.estimatedArea, 1)}㎡`
    : "계산 불가";
  elements.metricAreaPyeong.textContent = latest?.estimatedArea
    ? `약 ${formatNumber(toPyeong(latest.estimatedArea), 1)}평 · ${formatMoney(budget)} 기준`
    : "계산할 수 없습니다";
  elements.metricCount.textContent = latest
    ? `${formatNumber(latest.tradeCount, 0)}건`
    : "—";

  elements.metricChange.classList.remove("positive", "negative");

  if (change === null) {
    elements.metricChange.textContent = "비교 불가";
  } else {
    elements.metricChange.textContent = `${change > 0 ? "+" : ""}${formatNumber(change, 1)}%`;
    elements.metricChange.classList.add(change >= 0 ? "positive" : "negative");
  }
}

function renderInsight(first, latest, budget) {
  if (!first?.estimatedArea || !latest?.estimatedArea) {
    const missingYears = [
      !first?.estimatedArea && "2022년",
      !latest?.estimatedArea && "2026년 누적",
    ].filter(Boolean);
    const condition = `${currentAnalysis.neighborhoodName} ${currentAnalysis.buildingTypeLabel}`;
    elements.insightText.textContent = `${missingYears.join("·")} ${condition} 전세 거래가 0건이라 5년 변화를 계산할 수 없습니다. 데이터 오류가 아니며, 다른 주택유형이나 동을 선택해 보세요.`;
    return;
  }

  const areaDifference = latest.estimatedArea - first.estimatedArea;
  const direction = areaDifference >= 0 ? "늘었습니다" : "줄었습니다";

  elements.insightText.textContent = `${formatMoney(budget)}으로 예상되는 면적은 2022년 ${formatNumber(first.estimatedArea, 1)}㎡에서 2026년 ${formatNumber(latest.estimatedArea, 1)}㎡로, 약 ${formatNumber(Math.abs(areaDifference), 1)}㎡ ${direction}.`;
}

function renderCharts(yearly) {
  if (!window.Plotly) {
    showStatus("차트 도구를 불러오지 못했지만 아래 표에서 결과를 확인할 수 있습니다.");
    return;
  }

  const years = yearly.map((item) => String(item.year));
  const commonLayout = {
    autosize: true,
    margin: { t: 24, r: 16, b: 44, l: 60 },
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
    font: {
      family: 'Pretendard, "Noto Sans KR", sans-serif',
      color: "#46515e",
      size: 12,
    },
    xaxis: {
      fixedrange: true,
      showgrid: false,
      tickfont: { color: "#6f7780" },
    },
    yaxis: {
      fixedrange: true,
      gridcolor: "#ece8e0",
      zeroline: false,
      tickfont: { color: "#6f7780" },
    },
    hoverlabel: {
      bgcolor: "#17202b",
      bordercolor: "#17202b",
      font: { color: "#ffffff" },
    },
  };
  const config = {
    responsive: true,
    displayModeBar: false,
    locale: "ko",
  };

  window.Plotly.react(
    "power-chart",
    [
      {
        x: years,
        y: yearly.map((item) => item.estimatedArea),
        type: "scatter",
        mode: "lines+markers",
        line: { color: "#f26722", width: 4 },
        marker: { color: "#ffffff", line: { color: "#f26722", width: 3 }, size: 10 },
        connectgaps: false,
        hovertemplate: "%{x}년<br><b>%{y:.1f}㎡</b><extra></extra>",
      },
    ],
    {
      ...commonLayout,
      yaxis: { ...commonLayout.yaxis, title: "예상 면적(㎡)", rangemode: "tozero" },
    },
    config,
  );

  window.Plotly.react(
    "price-chart",
    [
      {
        x: years,
        y: yearly.map((item) => item.averageDeposit),
        type: "bar",
        marker: {
          color: yearly.map((item) => (item.year === 2026 ? "#f26722" : "#f2c4a9")),
          line: { color: "#e5986d", width: 1 },
        },
        hovertemplate: "%{x}년<br><b>%{y:,.0f}만 원</b><extra></extra>",
      },
    ],
    {
      ...commonLayout,
      yaxis: { ...commonLayout.yaxis, title: "평균 전세가(만원)", rangemode: "tozero" },
      bargap: 0.32,
    },
    config,
  );
}

function renderYearlyTable(yearly) {
  const rows = yearly.map((item) => {
    const row = document.createElement("tr");
    const values = [
      `${item.year}년`,
      item.averageDeposit ? formatMoney(item.averageDeposit) : "거래 0건",
      item.averagePricePerM2
        ? `${formatNumber(item.averagePricePerM2, 1)}만 원/㎡`
        : "—",
      item.estimatedArea
        ? `${formatNumber(item.estimatedArea, 1)}㎡ (${formatNumber(toPyeong(item.estimatedArea), 1)}평)`
        : "—",
      `${formatNumber(item.tradeCount, 0)}건`,
    ];

    values.forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    });

    return row;
  });

  elements.yearlyTableBody.replaceChildren(...rows);
}

function addCurrentComparison() {
  if (!currentAnalysis) return;

  const latest = currentAnalysis.yearly.find((item) => item.year === 2026);
  if (!latest?.averagePricePerM2) {
    showStatus("2026년 거래 자료가 없어 비교함에 추가할 수 없습니다.");
    return;
  }

  const key = [
    currentAnalysis.cggCode,
    currentAnalysis.stdgCode,
    currentAnalysis.buildingType,
  ].join("-");
  const existingIndex = comparisons.findIndex((item) => item.key === key);
  const comparison = {
    key,
    legalDongCode: `${currentAnalysis.cggCode}${currentAnalysis.stdgCode}`,
    districtName: currentAnalysis.districtName,
    neighborhoodName: currentAnalysis.neighborhoodName,
    buildingTypeLabel: currentAnalysis.buildingTypeLabel,
    averagePricePerM2: latest.averagePricePerM2,
    averageDeposit: latest.averageDeposit,
  };

  if (existingIndex >= 0) {
    comparisons[existingIndex] = comparison;
  } else if (comparisons.length < MAX_COMPARISONS) {
    comparisons.push(comparison);
  } else {
    showStatus("비교함에는 최대 3곳까지 추가할 수 있습니다.");
    return;
  }

  clearStatus();
  renderComparisons();
  renderMap();
  elements.comparisonSection.hidden = false;
  elements.comparisonSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderComparisons() {
  const budget = getBudget();
  const items = comparisons.map((comparison) => ({
    ...comparison,
    estimatedArea: estimateArea(budget, comparison.averagePricePerM2),
  }));

  elements.comparisonSection.hidden = items.length === 0;

  const cards = items.map((item) => {
    const card = document.createElement("div");
    card.className = "comparison-item";

    const text = document.createElement("div");
    const title = document.createElement("strong");
    const detail = document.createElement("span");
    title.textContent = `${item.districtName} ${item.neighborhoodName}`;
    detail.textContent = `${item.buildingTypeLabel} · ${formatNumber(item.estimatedArea, 1)}㎡`;
    text.append(title, detail);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-button";
    remove.setAttribute("aria-label", `${item.neighborhoodName} 비교함에서 삭제`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      comparisons = comparisons.filter((comparison) => comparison.key !== item.key);
      renderComparisons();
      renderMap();
    });

    card.append(text, remove);
    return card;
  });

  elements.comparisonList.replaceChildren(...cards);

  if (!items.length || !window.Plotly) return;

  window.Plotly.react(
    "comparison-chart",
    [
      {
        x: items.map((item) => `${item.neighborhoodName} · ${item.buildingTypeLabel}`),
        y: items.map((item) => item.estimatedArea),
        type: "bar",
        marker: { color: ["#f26722", "#17202b", "#e4aa33"] },
        text: items.map((item) => `${formatNumber(item.estimatedArea, 1)}㎡`),
        textposition: "outside",
        cliponaxis: false,
        hovertemplate: "%{x}<br><b>%{y:.1f}㎡</b><extra></extra>",
      },
    ],
    {
      autosize: true,
      margin: { t: 40, r: 20, b: 65, l: 60 },
      paper_bgcolor: "#ffffff",
      plot_bgcolor: "#ffffff",
      showlegend: false,
      xaxis: { fixedrange: true, showgrid: false },
      yaxis: {
        fixedrange: true,
        title: `${formatMoney(budget)}으로 예상되는 면적(㎡)`,
        gridcolor: "#ece8e0",
        zeroline: false,
        rangemode: "tozero",
      },
      font: { family: 'Pretendard, "Noto Sans KR", sans-serif', color: "#46515e" },
    },
    { responsive: true, displayModeBar: false, locale: "ko" },
  );
}

function resizePlots() {
  if (!window.Plotly) return;

  ["seoul-map", "power-chart", "price-chart", "comparison-chart"].forEach((id) => {
    const chart = document.getElementById(id);
    if (chart && chart.data) window.Plotly.Plots.resize(chart);
  });
}

function setLoading(isLoading) {
  elements.loading.hidden = !isLoading;
  elements.analyzeButton.disabled = isLoading;
  elements.mapAnalyzeButton.disabled = isLoading;
  elements.analyzeButton.firstChild.textContent = isLoading
    ? "분석 중… "
    : "5년 변화 분석하기 ";
}

function getSelectedDistrict() {
  return regions.find((district) => district.code === elements.district.value) ?? null;
}

function getSelectedNeighborhood() {
  const district = getSelectedDistrict();
  return (
    district?.neighborhoods.find(
      (neighborhood) => neighborhood.code === elements.neighborhood.value,
    ) ?? null
  );
}

function getBudget() {
  return Number(elements.budget.value);
}

function updateBudgetLabel() {
  const budget = getBudget();
  elements.budgetReadable.textContent = Number.isFinite(budget) ? formatMoney(budget) : "—";
}

function estimateArea(budget, averagePricePerM2) {
  if (!budget || !averagePricePerM2) return null;
  return budget / averagePricePerM2;
}

function percentageChange(before, after) {
  if (!before || after === null || after === undefined) return null;
  return ((after - before) / before) * 100;
}

function toPyeong(squareMeters) {
  return squareMeters / 3.3058;
}

function formatMoney(value) {
  const amount = Math.round(Number(value));
  if (!Number.isFinite(amount)) return "—";

  const eok = Math.floor(amount / 10000);
  const manwon = amount % 10000;

  if (eok && manwon) return `${eok}억 ${formatNumber(manwon, 0)}만 원`;
  if (eok) return `${eok}억 원`;
  return `${formatNumber(manwon, 0)}만 원`;
}

function formatNumber(value, digits) {
  return Number(value).toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function showStatus(message) {
  elements.status.textContent = message;
}

function clearStatus() {
  elements.status.textContent = "";
}

function debounce(callback, delay) {
  let timer;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => callback(...args), delay);
  };
}

