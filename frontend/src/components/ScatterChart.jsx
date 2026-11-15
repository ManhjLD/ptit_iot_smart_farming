'use client';
import React from 'react';
import { ScatterChart as RScatterChart, Scatter, XAxis, YAxis, CartesianGrid, ZAxis, } from 'recharts';
import { format } from 'date-fns';
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, } from '@/components/ui/chart';
export function ScatterChart({ data, title, xKey, yKey, xLabel, yLabel, color, }) {
    const points = data.map((d) => ({
        x: Number(d[xKey]),
        y: Number(d[yKey]),
        createdAt: d.createdAt,
    }));
    const config = {
        series: { label: title, color },
    };
    return (<ChartContainer config={config} className="h-80 w-full">
      <RScatterChart margin={{ left: 12, right: 12 }}>
        <CartesianGrid strokeDasharray="3 3"/>
        <XAxis type="number" dataKey="x" name={xLabel}/>
        <YAxis type="number" dataKey="y" name={yLabel}/>
        <ZAxis range={[100]}/>
        <ChartTooltip content={<ChartTooltipContent />} formatter={(_value, _name, item) => {
            const p = item && typeof item === 'object' && 'payload' in item
                ? item.payload
                : undefined;
            if (!p)
                return ['-', ''];
            return [
                `${p.y}`,
                `${yLabel} | ${xLabel}: ${p.x} | ${format(new Date(p.createdAt), 'MMM dd, HH:mm:ss')}`,
            ];
        }}/>
        <ChartLegend content={<ChartLegendContent />}/>
        <Scatter name={title} data={points} fill="var(--color-series)"/>
      </RScatterChart>
    </ChartContainer>);
}
