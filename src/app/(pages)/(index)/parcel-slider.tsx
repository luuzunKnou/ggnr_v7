"use client"

import React, { useState, useEffect } from "react"
import Link from "next/link"

interface ParcelSlide {
  title: string
  description: string
  image?: string
  gradient?: string
}

interface ParcelSliderProps {
  slides: ParcelSlide[]
}

export function ParcelSlider({ slides }: ParcelSliderProps) {
  const [currentIndex, setCurrentIndex] = useState(0)

  const goToSlide = (index: number) => {
    setCurrentIndex(index)
  }

  const goToPrevious = () => {
    setCurrentIndex((prev) => (prev === 0 ? slides.length - 1 : prev - 1))
  }

  const goToNext = () => {
    setCurrentIndex((prev) => (prev === slides.length - 1 ? 0 : prev + 1))
  }

  // 1초마다 다음 슬라이드로 자동 전환
  useEffect(() => {
    if (slides.length <= 1) return
    const id = setInterval(() => {
      setCurrentIndex((prev) => (prev === slides.length - 1 ? 0 : prev + 1))
    }, 3000)
    return () => clearInterval(id)
  }, [slides.length])

  return (
    <div className="relative overflow-hidden min-h-[280px] rounded">
      {/* Slides — z-0으로 두고 컨트롤(z-10)이 항상 위에 오게 함 */}
      <div className="relative z-0 min-h-[280px] h-full">
        {slides.map((slide, index) => (
          <div
            key={index}
            className={`absolute inset-0 transition-opacity duration-500 ${
              index === currentIndex
                ? "z-[1] opacity-100"
                : "z-0 opacity-0 pointer-events-none"
            }`}
          >
            {slide.image ? (
              <img
                src={slide.image}
                alt=""
                className="absolute inset-0 h-full w-full object-cover pointer-events-none select-none"
                draggable={false}
                decoding="async"
              />
            ) : (
              <div
                className="absolute inset-0 h-full w-full"
                style={{
                  background: slide.gradient || "linear-gradient(to bottom right, #1e293b, #0f172a)",
                }}
              />
            )}
            <div className="absolute inset-0 bg-black/50"></div>
            <div className="relative h-full p-8 flex flex-col text-white">
              <div>
                <h2 className="text-2xl font-bold mb-3">{slide.title}</h2>
                <p className="text-slate-300 text-sm leading-relaxed">
                  {slide.description}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Navigation Buttons */}
      <button
        type="button"
        onClick={goToPrevious}
        className="absolute z-10 left-4 top-1/2 -translate-y-1/2 bg-white/10 hover:bg-white/20 backdrop-blur rounded-full p-2 transition-colors"
        aria-label="Previous slide"
      >
        <svg
          className="w-5 h-5 text-white"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 19l-7-7 7-7"
          />
        </svg>
      </button>
      <button
        type="button"
        onClick={goToNext}
        className="absolute z-10 right-4 top-1/2 -translate-y-1/2 bg-white/10 hover:bg-white/20 backdrop-blur rounded-full p-2 transition-colors"
        aria-label="Next slide"
      >
        <svg
          className="w-5 h-5 text-white"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
      </button>

      {/* 바로가기 — 지도 이동 후 시스템 선택 */}
      <Link
        href="/map"
        className="absolute z-10 bottom-[calc(1rem+30px+0.5rem)] left-1/2 -translate-x-1/2 inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 backdrop-blur px-6 py-3 text-sm font-medium transition-colors text-white rounded-[5px]"
      >
        바로가기
        <svg
          className="w-4 h-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="m12 8 4 4-4 4" />
          <path d="M8 12h8" />
        </svg>
      </Link>

      {/* Indicators */}
      <div className="absolute z-10 bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
        {slides.map((_, index) => (
          <button
            type="button"
            key={index}
            onClick={() => goToSlide(index)}
            className={`h-2 rounded-full transition-all ${
              index === currentIndex
                ? "w-8 bg-white"
                : "w-2 bg-white/50 hover:bg-white/75"
            }`}
            aria-label={`Go to slide ${index + 1}`}
          />
        ))}
      </div>
    </div>
  )
}
