"use client"

import React from "react"

import { Card } from "@/app/shadcnComponents/ui/card"
import Link from "next/link"

export interface ChartDataPoint {
  label: string
  value: number
}

export interface DepartmentData {
  key: string
  name: string
  iconSvg: string
  color: string
  url: string
  chartData?: ChartDataPoint[]
}

interface DepartmentCardProps {
  department: DepartmentData
}

export function DepartmentCard({ department }: DepartmentCardProps) {
  const { name, iconSvg, color, url, chartData } = department

  return (
    <Link href={url} className="block group">
      <Card className="p-6 h-full transition-all duration-300 hover:shadow-lg hover:-translate-y-1 border-2 border-transparent hover:border-current"
        style={{ 
          '--card-color': color,
          borderColor: 'transparent',
        } as React.CSSProperties}
      >
        <div className="flex flex-col items-center gap-4">
          {/* Icon Container */}
          <div 
            className="w-20 h-20 rounded-full flex items-center justify-center transition-transform duration-300 group-hover:scale-110"
            style={{ 
              backgroundColor: `${color}15`,
              border: `2px solid ${color}30`
            }}
          >
            <div 
              className="w-10 h-10 flex items-center justify-center"
              style={{ color }}
              dangerouslySetInnerHTML={{ __html: iconSvg }}
            />
          </div>

          {/* Department Name */}
          <h3 
            className="text-sm font-medium text-center leading-tight transition-colors duration-300"
            style={{ color: 'var(--foreground)' }}
          >
            {name}
          </h3>
        </div>
      </Card>
    </Link>
  )
}
