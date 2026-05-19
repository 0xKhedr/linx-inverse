const body = document.body;
const defaultStart = body.dataset.defaultStart;
const defaultEnd = body.dataset.defaultEnd;
const ui = JSON.parse(document.getElementById("ui-copy").textContent);
const startInput = document.getElementById("start-input");
const endInput = document.getElementById("end-input");

const state = {
    charts: {
        series: null,
        daily: null,
    },
    seriesPayload: null,
    seriesSmoothingStats: null,
    seriesSmoothness: 100,
    seriesRefreshFrame: null,
};

const seriesSmoothnessInput = document.getElementById("series-smoothness");
const seriesSmoothnessLabel = document.getElementById("series-smoothness-label");
const reportLink = document.getElementById("report-link");
const languageInput = document.getElementById("language-input");
const thresholdRegionPlugin = {
    id: "thresholdRegionPlugin",
    beforeDraw(chart, _args, options) {
        const { ctx, chartArea, scales } = chart;
        if (!chartArea || !scales.y) {
            return;
        }

        const { left, right, top, bottom } = chartArea;
        const yScale = scales.y;
        const lowThreshold = options?.lowThreshold;
        const highThreshold = options?.highThreshold;

        ctx.save();

        if (highThreshold !== undefined && highThreshold !== null) {
            const highY = yScale.getPixelForValue(highThreshold);
            ctx.fillStyle = "rgba(185, 28, 28, 0.08)";
            ctx.fillRect(left, top, right - left, Math.max(0, highY - top));
        }

        if (lowThreshold !== undefined && lowThreshold !== null) {
            const lowY = yScale.getPixelForValue(lowThreshold);
            ctx.fillStyle = "rgba(194, 65, 12, 0.08)";
            ctx.fillRect(left, Math.min(lowY, bottom), right - left, Math.max(0, bottom - lowY));
        }

        ctx.restore();
    },
};

const summaryFields = {
    latestGlucose: document.getElementById("latest-glucose"),
    latestTimestamp: document.getElementById("latest-timestamp"),
    recordCount: document.getElementById("record-count"),
    avgGlucose: document.getElementById("avg-glucose"),
    minMax: document.getElementById("min-max"),
    rangeMix: document.getElementById("range-mix"),
    qualitySummary: document.getElementById("quality-summary"),
    qualityDetail: document.getElementById("quality-detail"),
    validCount: document.getElementById("valid-count"),
    invalidCount: document.getElementById("invalid-count"),
    alertCount: document.getElementById("alert-count"),
    avgQuality: document.getElementById("avg-quality"),
    statusCounts: document.getElementById("status-counts"),
    qualityBands: document.getElementById("quality-bands"),
    recentLows: document.getElementById("recent-lows"),
    recentHighs: document.getElementById("recent-highs"),
};

function toApiDate(value) {
    if (!value) {
        return value;
    }
    const normalized = value.length === 16 ? `${value}:00` : value;
    return normalized.replace("T", " ");
}

function formatNumber(value, fractionDigits = 0) {
    if (value === null || value === undefined) {
        return "--";
    }
    return new Intl.NumberFormat(body.dataset.locale || undefined, {
        maximumFractionDigits: fractionDigits,
        minimumFractionDigits: fractionDigits,
    }).format(value);
}

function formatPercent(value) {
    return `${formatNumber(value, 1)}%`;
}

function parseAppTime(value) {
    return new Date(value.replace(" ", "T"));
}

function createTimeFormatter(includeDate) {
    return new Intl.DateTimeFormat(body.dataset.locale || undefined, includeDate
        ? {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        }
        : {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        });
}

function createDateFormatter() {
    return new Intl.DateTimeFormat(body.dataset.locale || undefined, {
        month: "short",
        day: "numeric",
    });
}

function floorToLocalDay(timestampMs) {
    const date = new Date(timestampMs);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}

function ceilToLocalDay(timestampMs) {
    const floorMs = floorToLocalDay(timestampMs);
    return floorMs === timestampMs ? timestampMs : floorMs + (24 * 60 * 60 * 1000);
}

function floorToLocalHourStep(timestampMs, stepHours) {
    const date = new Date(timestampMs);
    date.setMinutes(0, 0, 0);
    date.setHours(date.getHours() - (date.getHours() % stepHours));
    return date.getTime();
}

function ceilToLocalHourStep(timestampMs, stepHours) {
    const floorMs = floorToLocalHourStep(timestampMs, stepHours);
    return floorMs === timestampMs ? timestampMs : floorMs + (stepHours * 60 * 60 * 1000);
}

function floorToLocalMinuteStep(timestampMs, stepMinutes) {
    const date = new Date(timestampMs);
    date.setSeconds(0, 0);
    date.setMinutes(date.getMinutes() - (date.getMinutes() % stepMinutes));
    return date.getTime();
}

function ceilToLocalMinuteStep(timestampMs, stepMinutes) {
    const floorMs = floorToLocalMinuteStep(timestampMs, stepMinutes);
    return floorMs === timestampMs ? timestampMs : floorMs + (stepMinutes * 60 * 1000);
}

function buildTimeSeriesPoints(points) {
    return points.map((point) => ({
        x: parseAppTime(point.appTime).getTime(),
        y: point.glucose,
    }));
}

function buildThresholdLine(startMs, endMs, value) {
    return [
        { x: startMs, y: value },
        { x: endMs, y: value },
    ];
}

function getTimeAxisConfig(startMs, endMs) {
    const spanMs = Math.abs(endMs - startMs);
    const hourMs = 60 * 60 * 1000;
    const dayMs = 24 * hourMs;

    if (spanMs > 5 * dayMs) {
        return {
            min: floorToLocalDay(startMs),
            max: ceilToLocalDay(endMs),
            stepSize: dayMs,
            formatTick: (value) => createDateFormatter().format(new Date(Number(value))),
        };
    }

    if (spanMs > 2 * dayMs) {
        const stepSize = 6 * hourMs;
        return {
            min: floorToLocalDay(startMs),
            max: ceilToLocalDay(endMs),
            stepSize,
            formatTick: (value) => createTimeFormatter(true).format(new Date(Number(value))),
        };
    }

    if (spanMs > 12 * hourMs) {
        const stepSize = hourMs;
        return {
            min: floorToLocalHourStep(startMs, 1),
            max: ceilToLocalHourStep(endMs, 1),
            stepSize,
            formatTick: (value) => createTimeFormatter(false).format(new Date(Number(value))),
        };
    }

    const stepSize = 30 * 60 * 1000;
    return {
        min: floorToLocalMinuteStep(startMs, 30),
        max: ceilToLocalMinuteStep(endMs, 30),
        stepSize,
        formatTick: (value) => createTimeFormatter(false).format(new Date(Number(value))),
    };
}

function formatTimeTick(value, axisConfig) {
    return axisConfig.formatTick(value);
}

function getSeriesYRange(points, thresholds) {
    const lowThreshold = thresholds.low ?? thresholds.lowThreshold;
    const highThreshold = thresholds.high ?? thresholds.highThreshold;
    const values = points
        .map((point) => point.glucose)
        .filter((value) => value !== null && value !== undefined);
    const baselineValues = [lowThreshold, highThreshold, ...values];
    const minValue = Math.min(...baselineValues);
    const maxValue = Math.max(...baselineValues);
    const padding = 8;

    return {
        min: Math.max(0, Math.floor((minValue - padding) / 10) * 10),
        max: Math.ceil((maxValue + padding) / 10) * 10,
    };
}

function fetchJson(url) {
    return fetch(url).then(async (response) => {
        const payload = await response.json();
        if (!response.ok) {
            throw new Error(payload.error || "Request failed.");
        }
        return payload;
    });
}

function getSeriesTension() {
    return 0.18;
}

function getSeriesSmoothingWindow() {
    return Math.max(1, Math.round((state.seriesSmoothness / 100) * 72));
}

function getSeriesSmoothnessLabel() {
    if (state.seriesSmoothness >= 85) {
        return ui.most_smooth;
    }
    if (state.seriesSmoothness >= 55) {
        return ui.balanced;
    }
    if (state.seriesSmoothness >= 20) {
        return ui.sharper;
    }
    return ui.raw;
}

function updateSeriesSmoothnessLabel() {
    seriesSmoothnessLabel.textContent = getSeriesSmoothnessLabel();
}

function buildSeriesSmoothingStats(points) {
    const prefixSums = [0];
    const prefixCounts = [0];

    points.forEach((point) => {
        const value = point.glucose;
        const isNumeric = value !== null && value !== undefined;
        prefixSums.push(prefixSums[prefixSums.length - 1] + (isNumeric ? value : 0));
        prefixCounts.push(prefixCounts[prefixCounts.length - 1] + (isNumeric ? 1 : 0));
    });

    return { prefixSums, prefixCounts };
}

function getSmoothedSeriesValues(points) {
    const windowSize = getSeriesSmoothingWindow();
    if (windowSize <= 1) {
        return points.map((point) => point.glucose);
    }

    const radius = Math.floor(windowSize / 2);
    const stats = state.seriesSmoothingStats ?? buildSeriesSmoothingStats(points);
    const { prefixSums, prefixCounts } = stats;

    return points.map((point, index) => {
        const start = Math.max(0, index - radius);
        const end = Math.min(points.length - 1, index + radius);
        const total = prefixSums[end + 1] - prefixSums[start];
        const count = prefixCounts[end + 1] - prefixCounts[start];

        return count ? Number((total / count).toFixed(2)) : point.glucose;
    });
}

function buildQuery(start, end, extras = {}) {
    const params = new URLSearchParams({ start, end, ...extras });
    return `?${params.toString()}`;
}

function syncReportLink(start, end, language) {
    if (!reportLink) {
        return;
    }
    reportLink.href = `/report${buildQuery(start, end, { lang: language })}`;
}

function renderDistribution(listNode, rows, labelKey) {
    listNode.replaceChildren();
    if (!rows.length) {
        const item = document.createElement("li");
        item.className = "empty-state";
        item.textContent = ui.empty_range;
        listNode.appendChild(item);
        return;
    }

    rows.forEach((row) => {
        const item = document.createElement("li");
        const label = document.createElement("span");
        const count = document.createElement("strong");
        label.textContent = row[labelKey];
        count.textContent = formatNumber(row.count, 0);
        item.append(label, count);
        listNode.appendChild(item);
    });
}

function renderEvents(tbody, rows) {
    tbody.replaceChildren();
    if (!rows.length) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 3;
        td.className = "empty-state";
        td.textContent = ui.no_events;
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
    }

    rows.forEach((row) => {
        const tr = document.createElement("tr");
        [row.appTime, formatNumber(row.glucose, 0), formatNumber(row.quality, 0)].forEach((value) => {
            const td = document.createElement("td");
            td.textContent = value;
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
}

function renderSummary(summary) {
    const latest = summary.latest;
    const metrics = summary.metrics;
    const quality = summary.quality;

    summaryFields.latestGlucose.textContent = latest ? `${formatNumber(latest.glucose, 0)} mg/dL` : "--";
    summaryFields.latestTimestamp.textContent = latest ? latest.appTime : ui.no_rows_in_selected_range;
    summaryFields.recordCount.textContent = formatNumber(metrics.recordCount, 0);
    summaryFields.avgGlucose.textContent = metrics.avgGlucose !== null ? `${formatNumber(metrics.avgGlucose, 1)} mg/dL` : "--";
    summaryFields.minMax.textContent = metrics.minGlucose !== null && metrics.maxGlucose !== null
        ? `${formatNumber(metrics.minGlucose, 0)} / ${formatNumber(metrics.maxGlucose, 0)}`
        : "--";
    summaryFields.rangeMix.textContent = `${formatPercent(metrics.lowPercent)} / ${formatPercent(metrics.inRangePercent)} / ${formatPercent(metrics.highPercent)}`;
    summaryFields.qualitySummary.textContent = quality.avgQuality !== null ? ui.quality_avg.replace("{value}", formatNumber(quality.avgQuality, 1)) : "--";
    summaryFields.qualityDetail.textContent = ui.valid_invalid
        .replace("{valid}", quality.validCount)
        .replace("{invalid}", quality.invalidCount);
    summaryFields.validCount.textContent = formatNumber(quality.validCount, 0);
    summaryFields.invalidCount.textContent = formatNumber(quality.invalidCount, 0);
    summaryFields.alertCount.textContent = formatNumber(quality.alertCount, 0);
    summaryFields.avgQuality.textContent = quality.avgQuality !== null ? formatNumber(quality.avgQuality, 1) : "--";

    renderDistribution(summaryFields.statusCounts, quality.statusCounts, "status");
    renderDistribution(summaryFields.qualityBands, quality.qualityBands, "band");
    renderEvents(summaryFields.recentLows, summary.recentLows);
    renderEvents(summaryFields.recentHighs, summary.recentHighs);
}

function createOrUpdateChart(chartKey, canvasId, configFactory, updateFn) {
    const existingChart = state.charts[chartKey];
    if (!existingChart) {
        const context = document.getElementById(canvasId);
        const config = configFactory();
        if (chartKey === "series") {
            config.plugins = [thresholdRegionPlugin];
        }
        state.charts[chartKey] = new Chart(context, config);
        return;
    }

    updateFn(existingChart);
    existingChart.update("none");
}

function renderSeriesChart(payload, thresholds) {
    state.seriesPayload = payload;
    state.seriesSmoothingStats = buildSeriesSmoothingStats(payload.points);
    const startMs = parseAppTime(payload.start).getTime();
    const endMs = parseAppTime(payload.end).getTime();
    const axisConfig = getTimeAxisConfig(startMs, endMs);
    const yRange = getSeriesYRange(payload.points, thresholds);
    const values = getSmoothedSeriesValues(payload.points);
    const seriesPoints = payload.points.map((point, index) => ({
        x: parseAppTime(point.appTime).getTime(),
        y: values[index],
    }));
    const tension = getSeriesTension();
    const lowThreshold = thresholds.low;
    const highThreshold = thresholds.high;
    const lowLine = buildThresholdLine(axisConfig.min, axisConfig.max, lowThreshold);
    const highLine = buildThresholdLine(axisConfig.min, axisConfig.max, highThreshold);

    createOrUpdateChart("series", "series-chart", () => ({
        type: "line",
        data: {
            datasets: [
                {
                    label: ui.glucose_series_label,
                    data: seriesPoints,
                    borderColor: "#1f6f84",
                    backgroundColor: "rgba(31, 111, 132, 0.15)",
                    pointRadius: 0,
                    fill: false,
                    cubicInterpolationMode: "monotone",
                    tension,
                    borderWidth: 2,
                    normalized: true,
                    order: 1,
                },
                {
                    label: ui.low_threshold_label.replace("{value}", lowThreshold),
                    data: lowLine,
                    borderColor: "rgba(194, 65, 12, 0.85)",
                    borderDash: [6, 6],
                    pointRadius: 0,
                    borderWidth: 1.5,
                    fill: false,
                    order: 0,
                },
                {
                    label: ui.high_threshold_label.replace("{value}", highThreshold),
                    data: highLine,
                    borderColor: "rgba(185, 28, 28, 0.85)",
                    borderDash: [6, 6],
                    pointRadius: 0,
                    borderWidth: 1.5,
                    fill: false,
                    order: 0,
                },
            ],
        },
        options: {
            parsing: false,
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: true },
                tooltip: {
                    callbacks: {
                        title(items) {
                            if (!items.length) {
                                return "";
                            }
                            return createTimeFormatter(true).format(new Date(items[0].parsed.x));
                        },
                    },
                },
                thresholdRegionPlugin: {
                    lowThreshold,
                    highThreshold,
                },
            },
            scales: {
                x: {
                    type: "linear",
                    min: axisConfig.min,
                    max: axisConfig.max,
                    ticks: {
                        maxTicksLimit: 8,
                        stepSize: axisConfig.stepSize,
                        callback(value) {
                            return formatTimeTick(value, axisConfig);
                        },
                    },
                },
                y: {
                    beginAtZero: false,
                    min: yRange.min,
                    max: yRange.max,
                },
            },
        },
    }), (chart) => {
        chart.data.datasets[0].data = seriesPoints;
        chart.data.datasets[0].tension = tension;
        chart.data.datasets[0].cubicInterpolationMode = "monotone";
        chart.data.datasets[1].data = lowLine;
        chart.data.datasets[1].label = ui.low_threshold_label.replace("{value}", lowThreshold);
        chart.data.datasets[2].data = highLine;
        chart.data.datasets[2].label = ui.high_threshold_label.replace("{value}", highThreshold);
        chart.options.scales.x.min = axisConfig.min;
        chart.options.scales.x.max = axisConfig.max;
        chart.options.scales.x.ticks.stepSize = axisConfig.stepSize;
        chart.options.scales.x.ticks.callback = (value) => formatTimeTick(value, axisConfig);
        chart.options.scales.y.min = yRange.min;
        chart.options.scales.y.max = yRange.max;
        chart.options.plugins.thresholdRegionPlugin.lowThreshold = lowThreshold;
        chart.options.plugins.thresholdRegionPlugin.highThreshold = highThreshold;
    });
}

function refreshSeriesChart() {
    if (!state.charts.series || !state.seriesPayload) {
        return;
    }

    const smoothedValues = getSmoothedSeriesValues(state.seriesPayload.points);
    state.charts.series.data.datasets[0].data = state.seriesPayload.points.map((point, index) => ({
        x: parseAppTime(point.appTime).getTime(),
        y: smoothedValues[index],
    }));
    state.charts.series.data.datasets[0].tension = getSeriesTension();
    state.charts.series.data.datasets[0].cubicInterpolationMode = "monotone";
    const yRange = getSeriesYRange(state.seriesPayload.points, state.charts.series.options.plugins.thresholdRegionPlugin);
    state.charts.series.options.scales.y.min = yRange.min;
    state.charts.series.options.scales.y.max = yRange.max;
    state.charts.series.update("none");
}

function scheduleSeriesChartRefresh() {
    if (state.seriesRefreshFrame !== null) {
        cancelAnimationFrame(state.seriesRefreshFrame);
    }

    state.seriesRefreshFrame = requestAnimationFrame(() => {
        state.seriesRefreshFrame = null;
        refreshSeriesChart();
    });
}

function renderDailyChart(payload) {
    const labels = payload.days.map((day) => day.day);

    createOrUpdateChart("daily", "daily-chart", () => ({
        type: "bar",
        data: {
            labels,
            datasets: [
                {
                    type: "line",
                    label: ui.daily_average_label,
                    data: payload.days.map((day) => day.avgGlucose),
                    borderColor: "#bf5b2c",
                    backgroundColor: "#bf5b2c",
                    tension: 0.25,
                    yAxisID: "y",
                },
                {
                    label: ui.daily_minimum_label,
                    data: payload.days.map((day) => day.minGlucose),
                    backgroundColor: "rgba(194, 65, 12, 0.72)",
                    yAxisID: "y",
                },
                {
                    label: ui.daily_maximum_label,
                    data: payload.days.map((day) => day.maxGlucose),
                    backgroundColor: "rgba(31, 111, 132, 0.72)",
                    yAxisID: "y",
                },
            ],
        },
        options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: false,
                },
            },
        },
    }), (chart) => {
        chart.data.labels = labels;
        chart.data.datasets[0].data = payload.days.map((day) => day.avgGlucose);
        chart.data.datasets[1].data = payload.days.map((day) => day.minGlucose);
        chart.data.datasets[2].data = payload.days.map((day) => day.maxGlucose);
    });
}

function setFormDisabled(disabled) {
    document.querySelectorAll("#range-form input, #range-form button, #range-form select").forEach((element) => {
        element.disabled = disabled;
    });
}

function loadDashboard(start = defaultStart, end = defaultEnd) {
    if (!start || !end) {
        return Promise.resolve();
    }

    setFormDisabled(true);
    const language = languageInput?.value || body.dataset.language || "en";
    syncReportLink(start, end, language);
    const query = buildQuery(start, end);

    return fetchJson(`/api/dashboard${query}`).then((payload) => {
        renderSummary(payload.summary);
        renderSeriesChart(payload.series, payload.summary.thresholds);
        renderDailyChart(payload.daily);
    }).catch((error) => {
        window.alert(error.message);
    }).finally(() => {
        setFormDisabled(false);
    });
}

document.getElementById("range-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const start = toApiDate(startInput.value);
    const end = toApiDate(endInput.value);
    const language = languageInput?.value || "en";
    const url = new URL(window.location.href);
    url.searchParams.set("start", start);
    url.searchParams.set("end", end);
    url.searchParams.set("lang", language);
    window.history.replaceState({}, "", url);
    loadDashboard(start, end);
});

languageInput?.addEventListener("change", () => {
    const start = toApiDate(startInput.value) || defaultStart;
    const end = toApiDate(endInput.value) || defaultEnd;
    const url = new URL(window.location.href);
    url.searchParams.set("start", start);
    url.searchParams.set("end", end);
    url.searchParams.set("lang", languageInput.value);
    window.location.href = url.toString();
});

seriesSmoothnessInput.addEventListener("change", (event) => {
    state.seriesSmoothness = Number(event.target.value);
    scheduleSeriesChartRefresh();
    updateSeriesSmoothnessLabel();
});

seriesSmoothnessInput.addEventListener("input", (event) => {
    state.seriesSmoothness = Number(event.target.value);
    scheduleSeriesChartRefresh();
    updateSeriesSmoothnessLabel();
});

updateSeriesSmoothnessLabel();

const initialParams = new URLSearchParams(window.location.search);
const initialStart = initialParams.get("start") || defaultStart;
const initialEnd = initialParams.get("end") || defaultEnd;

if (initialParams.has("start")) {
    startInput.value = initialParams.get("start").replace(" ", "T");
}

if (initialParams.has("end")) {
    endInput.value = initialParams.get("end").replace(" ", "T");
}

loadDashboard(initialStart, initialEnd);
