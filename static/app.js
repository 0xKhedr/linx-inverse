const body = document.body;
const defaultStart = body.dataset.defaultStart;
const defaultEnd = body.dataset.defaultEnd;

const state = {
    charts: {
        series: null,
        daily: null,
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
    return value.replace("T", " ");
}

function formatNumber(value, fractionDigits = 0) {
    if (value === null || value === undefined) {
        return "--";
    }
    return new Intl.NumberFormat(undefined, {
        maximumFractionDigits: fractionDigits,
        minimumFractionDigits: fractionDigits,
    }).format(value);
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

function buildQuery(start, end) {
    const params = new URLSearchParams({ start, end });
    return `?${params.toString()}`;
}

function renderDistribution(listNode, rows, labelKey) {
    listNode.innerHTML = "";
    if (!rows.length) {
        const item = document.createElement("li");
        item.className = "empty-state";
        item.textContent = "No data in this range.";
        listNode.appendChild(item);
        return;
    }

    rows.forEach((row) => {
        const item = document.createElement("li");
        item.innerHTML = `<span>${row[labelKey]}</span><strong>${row.count}</strong>`;
        listNode.appendChild(item);
    });
}

function renderEvents(tbody, rows) {
    tbody.innerHTML = "";
    if (!rows.length) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td colspan="3" class="empty-state">No events in this range.</td>`;
        tbody.appendChild(tr);
        return;
    }

    rows.forEach((row) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${row.appTime}</td>
            <td>${formatNumber(row.glucose, 0)}</td>
            <td>${formatNumber(row.quality, 0)}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderSummary(summary) {
    const latest = summary.latest;
    const metrics = summary.metrics;
    const quality = summary.quality;

    summaryFields.latestGlucose.textContent = latest ? `${formatNumber(latest.glucose, 0)} mg/dL` : "--";
    summaryFields.latestTimestamp.textContent = latest ? latest.appTime : "No rows in selected range";
    summaryFields.recordCount.textContent = formatNumber(metrics.recordCount, 0);
    summaryFields.avgGlucose.textContent = metrics.avgGlucose !== null ? `${formatNumber(metrics.avgGlucose, 1)} mg/dL` : "--";
    summaryFields.minMax.textContent = metrics.minGlucose !== null && metrics.maxGlucose !== null
        ? `${formatNumber(metrics.minGlucose, 0)} / ${formatNumber(metrics.maxGlucose, 0)}`
        : "--";
    summaryFields.rangeMix.textContent = `${formatNumber(metrics.lowPercent, 1)}% / ${formatNumber(metrics.inRangePercent, 1)}% / ${formatNumber(metrics.highPercent, 1)}%`;
    summaryFields.qualitySummary.textContent = quality.avgQuality !== null ? `${formatNumber(quality.avgQuality, 1)} avg` : "--";
    summaryFields.qualityDetail.textContent = `${quality.validCount} valid, ${quality.invalidCount} invalid`;
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
        state.charts[chartKey] = new Chart(context, configFactory());
        return;
    }

    updateFn(existingChart);
    existingChart.update("none");
}

function renderSeriesChart(payload) {
    const labels = payload.points.map((point) => point.appTime);
    const values = payload.points.map((point) => point.glucose);

    createOrUpdateChart("series", "series-chart", () => ({
        type: "line",
        data: {
            labels,
            datasets: [{
                label: "Glucose (mg/dL)",
                data: values,
                borderColor: "#1f6f84",
                backgroundColor: "rgba(31, 111, 132, 0.15)",
                pointRadius: 0,
                fill: true,
                tension: 0.22,
                borderWidth: 2,
                normalized: true,
            }],
        },
        options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
            },
            scales: {
                x: {
                    ticks: { maxTicksLimit: 8 },
                },
                y: {
                    beginAtZero: false,
                },
            },
        },
    }), (chart) => {
        chart.data.labels = labels;
        chart.data.datasets[0].data = values;
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
                    label: "Average",
                    data: payload.days.map((day) => day.avgGlucose),
                    borderColor: "#bf5b2c",
                    backgroundColor: "#bf5b2c",
                    tension: 0.25,
                    yAxisID: "y",
                },
                {
                    label: "Minimum",
                    data: payload.days.map((day) => day.minGlucose),
                    backgroundColor: "rgba(194, 65, 12, 0.72)",
                    yAxisID: "y",
                },
                {
                    label: "Maximum",
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
    document.querySelectorAll("#range-form input, #range-form button").forEach((element) => {
        element.disabled = disabled;
    });
}

function loadDashboard(start = defaultStart, end = defaultEnd) {
    if (!start || !end) {
        return Promise.resolve();
    }

    setFormDisabled(true);
    const query = buildQuery(start, end);

    return fetchJson(`/api/dashboard${query}`).then((payload) => {
        renderSummary(payload.summary);
        renderSeriesChart(payload.series);
        renderDailyChart(payload.daily);
    }).catch((error) => {
        window.alert(error.message);
    }).finally(() => {
        setFormDisabled(false);
    });
}

document.getElementById("range-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const start = toApiDate(document.getElementById("start-input").value);
    const end = toApiDate(document.getElementById("end-input").value);
    loadDashboard(start, end);
});

loadDashboard();
