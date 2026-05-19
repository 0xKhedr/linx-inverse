const reportPayloadNode = document.getElementById("report-payload");

if (reportPayloadNode) {
    const reportPayload = JSON.parse(reportPayloadNode.textContent);
    const thresholds = reportPayload.summary.thresholds;
    const fullTimeFormatter = new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
    const shortTimeFormatter = new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
    const dateFormatter = new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
    });

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

    function parseAppTime(value) {
        return new Date(value.replace(" ", "T"));
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
                formatTick: (value) => dateFormatter.format(new Date(Number(value))),
            };
        }

        if (spanMs > 2 * dayMs) {
            const stepSize = 6 * hourMs;
            return {
                min: floorToLocalDay(startMs),
                max: ceilToLocalDay(endMs),
                stepSize,
                formatTick: (value) => fullTimeFormatter.format(new Date(Number(value))),
            };
        }

        if (spanMs > 12 * hourMs) {
            const stepSize = hourMs;
            return {
                min: floorToLocalHourStep(startMs, 1),
                max: ceilToLocalHourStep(endMs, 1),
                stepSize,
                formatTick: (value) => shortTimeFormatter.format(new Date(Number(value))),
            };
        }

        const stepSize = 30 * 60 * 1000;
        return {
            min: floorToLocalMinuteStep(startMs, 30),
            max: ceilToLocalMinuteStep(endMs, 30),
            stepSize,
            formatTick: (value) => shortTimeFormatter.format(new Date(Number(value))),
        };
    }

    function formatTimeTick(value, axisConfig) {
        return axisConfig.formatTick(value);
    }

    function getSharedYRange() {
        const lowThreshold = thresholds.low;
        const highThreshold = thresholds.high;
        const values = reportPayload.series.points
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

    function buildDayAxisConfig(dayLabel) {
        const startMs = parseAppTime(`${dayLabel} 00:00:00`).getTime();
        return {
            min: startMs,
            max: startMs + (24 * 60 * 60 * 1000),
            stepSize: 6 * 60 * 60 * 1000,
            formatTick: (value) => shortTimeFormatter.format(new Date(Number(value))),
        };
    }

    function buildChart(canvas, points, title, axisConfig, yRange) {
        const startMs = parseAppTime(points[0].appTime).getTime();
        const endMs = parseAppTime(points[points.length - 1].appTime).getTime();
        const values = points.map((point) => ({
            x: parseAppTime(point.appTime).getTime(),
            y: point.glucose,
        }));
        const computedAxisConfig = axisConfig ?? getTimeAxisConfig(startMs, endMs);
        const lowLine = buildThresholdLine(computedAxisConfig.min, computedAxisConfig.max, thresholds.low);
        const highLine = buildThresholdLine(computedAxisConfig.min, computedAxisConfig.max, thresholds.high);

        return new Chart(canvas, {
            type: "line",
            plugins: [thresholdRegionPlugin],
            data: {
                datasets: [
                    {
                        label: title,
                        data: values,
                        borderColor: "#1f6f84",
                        backgroundColor: "rgba(31, 111, 132, 0.12)",
                        fill: false,
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
                                return fullTimeFormatter.format(new Date(items[0].parsed.x));
                            },
                        },
                    },
                    thresholdRegionPlugin: {
                        lowThreshold: thresholds.low,
                        highThreshold: thresholds.high,
                    },
                },
                scales: {
                    x: {
                        type: "linear",
                        min: computedAxisConfig.min,
                        max: computedAxisConfig.max,
                        ticks: {
                            maxTicksLimit: 8,
                            stepSize: computedAxisConfig.stepSize,
                            callback(value) {
                                return formatTimeTick(value, computedAxisConfig);
                            },
                        },
                    },
                    y: {
                        beginAtZero: false,
                        min: yRange?.min,
                        max: yRange?.max,
                    },
                },
            },
        });
    }

    const sharedYRange = getSharedYRange();

    if (reportPayload.series.points.length) {
        buildChart(
            document.getElementById("report-overall-chart"),
            reportPayload.series.points,
            "Overall glucose",
            null,
            sharedYRange,
        );
    }

    document.querySelectorAll(".report-day-chart").forEach((canvas) => {
        const dayIndex = Number(canvas.dataset.dayIndex);
        const day = reportPayload.days[dayIndex];
        if (day.points.length) {
            buildChart(
                canvas,
                day.points,
                `${day.day} glucose`,
                buildDayAxisConfig(day.day),
                sharedYRange,
            );
        }
    });
}
