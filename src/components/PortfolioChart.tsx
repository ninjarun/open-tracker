// src/components/PortfolioChart.tsx
import React, { useMemo, useState } from 'react';
import { Dimensions, LayoutChangeEvent, View } from 'react-native';
import Svg, { Defs, Line, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';

type Props = {
  data: number[];
  color: string; // line + gradient colour
  labelColor: string; // high / low labels and dotted lines
  height?: number;
};

const MARGIN_Y = 22; // room above the high line / below the low line for the labels
const PAD_X = 2;

const formatUsd = (value: number) =>
  `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Smooth path through the points using monotone cubic interpolation
 * (Fritsch-Carlson). Unlike Catmull-Rom it never overshoots, so the curve
 * never goes above the real high or below the real low.
 */
function monotonePath(xs: number[], ys: number[]): string {
  const n = xs.length;
  if (n === 0) return '';
  if (n === 1) return `M ${xs[0].toFixed(2)} ${ys[0].toFixed(2)}`;

  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(xs[i + 1] - xs[i]);
    slope.push((ys[i + 1] - ys[i]) / dx[i]);
  }

  const m: number[] = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  }

  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * slope[i];
      m[i + 1] = t * b * slope[i];
    }
  }

  let path = `M ${xs[0].toFixed(2)} ${ys[0].toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i];
    const c1x = xs[i] + h / 3;
    const c1y = ys[i] + (m[i] * h) / 3;
    const c2x = xs[i + 1] - h / 3;
    const c2y = ys[i + 1] - (m[i + 1] * h) / 3;
    path += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${xs[i + 1].toFixed(2)} ${ys[i + 1].toFixed(2)}`;
  }
  return path;
}

export function PortfolioChart({ data, color, labelColor, height = 170 }: Props) {
  const [width, setWidth] = useState<number>(Dimensions.get('window').width - 48);

  const onLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    if (next > 0 && next !== width) setWidth(next);
  };

  const geometry = useMemo(() => {
    if (data.length < 2 || width <= 0) return null;

    let min = Infinity;
    let max = -Infinity;
    for (const v of data) {
      if (v < min) min = v;
      if (v > max) max = v;
    }

    const yTop = MARGIN_Y;
    const yBottom = height - MARGIN_Y;
    const span = max - min;

    const xs = data.map((_, i) => PAD_X + (i / (data.length - 1)) * (width - PAD_X * 2));
    const ys = data.map(v => (span > 0 ? yBottom - ((v - min) / span) * (yBottom - yTop) : (yTop + yBottom) / 2));

    const line = monotonePath(xs, ys);
    const area = `${line} L ${xs[xs.length - 1].toFixed(2)} ${height} L ${xs[0].toFixed(2)} ${height} Z`;

    return { min, max, yTop, yBottom, line, area };
  }, [data, width, height]);

  return (
    <View onLayout={onLayout} style={{ width: '100%', height }}>
      {geometry && (
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id="portfolioFill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity={0.32} />
              <Stop offset="1" stopColor={color} stopOpacity={0} />
            </LinearGradient>
          </Defs>

          {/* dotted high / low guide lines */}
          <Line
            x1={0}
            x2={width}
            y1={geometry.yTop}
            y2={geometry.yTop}
            stroke={labelColor}
            strokeOpacity={0.55}
            strokeWidth={1.5}
            strokeDasharray="1,6"
            strokeLinecap="round"
          />
          <Line
            x1={0}
            x2={width}
            y1={geometry.yBottom}
            y2={geometry.yBottom}
            stroke={labelColor}
            strokeOpacity={0.55}
            strokeWidth={1.5}
            strokeDasharray="1,6"
            strokeLinecap="round"
          />

          <Path d={geometry.area} fill="url(#portfolioFill)" />
          <Path
            d={geometry.line}
            stroke={color}
            strokeWidth={2.5}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          <SvgText x={width - 4} y={geometry.yTop - 7} fill={labelColor} fontSize={12} textAnchor="end">
            {formatUsd(geometry.max)}
          </SvgText>
          <SvgText x={width - 4} y={geometry.yBottom + 16} fill={labelColor} fontSize={12} textAnchor="end">
            {formatUsd(geometry.min)}
          </SvgText>
        </Svg>
      )}
    </View>
  );
}
