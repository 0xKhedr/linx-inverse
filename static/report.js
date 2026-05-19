const reportPayloadNode = document.getElementById("report-payload");

if (reportPayloadNode) {
    const reportPayload = JSON.parse(reportPayloadNode.textContent);
    const thresholds = reportPayload.summary.thresholds;

    const thresholdRegionPlugin = {
        id: "thresholdRegionPlugin",
        beforeDraw(chart, _args, options) {
            const { ctx, chartArea, scales } = chart;
            if (!chartArea || !scales.y) {
                return;
            }

            const { left, right, top, bottom } = chartArea;
            const yScale = scales.y;

            ctx.save();

            if (options.highThreshold !== undefined && options.highThreshold !== null) {
                const highY = yScale.getPixelForValue(options.highThreshold);
                ctx.fillStyle = "rgba(185, 28, 28, 0.08)";
                ctx.fillRect(left, top, right - left, Math.max(0, highY - top));
            }

            if (options.lowThreshold !== undefined && options.lowThreshold !== null) {
                const lowY = yScale.getPixelForValue(options.lowThreshold);
                ctx.fillStyle = "rgba(194, 65, 12, 0.08)";
                ctx.fillRect(left, Math.min(lowY, bottom), right - left, Math.max(0, bottom - lowY));
            }

            ctx.restore();
        },
    };

    function buildChart(canvas, points, title) {
        const labels = points.map((point) => point.appTime);
        const values = points.map((point) => point.glucose);
        const lowLine = labels.map(() => thresholds.low);
        const highLine = labels.map(() => thresholds.high);

        return new Chart(canvas, {
            type: "line",
            plugins: [thresholdRegionPlugin],
            data: {
                labels,
                datasets: [
                    {
                        label: title,
                        data: values,
                        borderColor: "#1f6f84",
                        backgroundColor: "rgba(31, 111, 132, 0.12)",
                        fill: true,
                        pointRadius: 0,
                        borderWidth: 2,
                        tension: 0.18,
                        cubicInterpolationMode: "monotone",
                    },
                    {
                        label: `Low threshold (${thresholds.low} mg/dL)`,
                        data: lowLine,
                        borderColor: "rgba(194, 65, 12, 0.85)",
                        borderDash: [6, 6],
                        pointRadius: 0,
                        borderWidth: 1.5,
                    },
                    {
                        label: `High threshold (${thresholds.high} mg/dL)`,
                        data: highLine,
                        borderColor: "rgba(185, 28, 28, 0.85)",
                        borderDash: [6, 6],
                        pointRadius: 0,
                        borderWidth: 1.5,
                    },
                ],
            },
            options: {
                animation: false,
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: true },
                    thresholdRegionPlugin: {
                        lowThreshold: thresholds.low,
                        highThreshold: thresholds.high,
                    },
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
        });
    }

    buildChart(document.getElementById("report-overall-chart"), reportPayload.series.points, "Overall glucose");

    document.querySelectorAll(".report-day-chart").forEach((canvas) => {
        const dayIndex = Number(canvas.dataset.dayIndex);
        const day = reportPayload.days[dayIndex];
        buildChart(canvas, day.points, `${day.day} glucose`);
    });
}
