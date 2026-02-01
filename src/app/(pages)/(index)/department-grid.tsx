"use client"

import { DepartmentCard, type DepartmentData } from "@/app/(pages)/(index)/department-card"

interface DepartmentGridProps {
  departments: DepartmentData[]
  title?: string
  description?: string
}

export function DepartmentGrid({ departments, title, description }: DepartmentGridProps) {
  if (departments.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        등록된 부서가 없습니다.
      </div>
    )
  }

  return (
    <section className="w-full">
      {(title || description) && (
        <div className="mb-8 text-center">
          {title && (
            <h2 className="text-2xl font-bold">{title}</h2>
          )}
          {description && (
            <p className="text-muted-foreground">{description}</p>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {departments.map((department) => (
          <DepartmentCard key={department.key} department={department} />
        ))}
      </div>
    </section>
  )
}
