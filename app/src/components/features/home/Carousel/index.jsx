import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

const Carousel = ({
  slides,
  autoPlay = true,
  autoPlayInterval = 5000,
  showIndicators = true,
  showArrows = true,
  className
}) => {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const nextSlide = useCallback(() => {
    setCurrentSlide((prev) => (prev + 1) % slides.length);
  }, [slides.length]);

  const prevSlide = useCallback(() => {
    setCurrentSlide((prev) => (prev - 1 + slides.length) % slides.length);
  }, [slides.length]);

  const goToSlide = (index) => {
    setCurrentSlide(index);
  };

  // Auto-play
  useEffect(() => {
    if (!autoPlay || isPaused || slides.length <= 1) return;

    const interval = setInterval(nextSlide, autoPlayInterval);
    return () => clearInterval(interval);
  }, [autoPlay, autoPlayInterval, isPaused, nextSlide, slides.length]);

  if (!slides || slides.length === 0) return null;

  return (
    <div
      className={cn('relative overflow-hidden rounded-2xl group w-full h-full', className)}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      role="region"
      aria-roledescription="carousel"
      aria-label="Product carousel"
    >
      {/* Slides */}
      <div
        className="flex transition-transform duration-700 ease-in-out h-full"
        style={{ transform: `translateX(-${currentSlide * 100}%)` }}
      >
        {slides.map((slide, index) => (
          <div
            key={index}
            className="w-full flex-shrink-0 relative h-[400px] md:h-[500px]"
            role="group"
            aria-roledescription="slide"
            aria-label={`Slide ${index + 1} of ${slides.length}`}
            aria-hidden={index !== currentSlide}
          >
            {slide.link ? (
              <a href={slide.link} className="block w-full h-full relative group/slide">
                <img
                  src={slide.image}
                  alt={slide.alt || `Slide ${index + 1}`}
                  className="w-full h-full object-cover group-hover/slide:scale-105 transition-transform duration-1000"
                  loading={index === 0 ? 'eager' : 'lazy'}
                />

                {/* Glassmorphic Text Overlay */}
                {(slide.title || slide.description) && (
                  <div className="absolute inset-0 bg-gradient-to-r from-zinc-950/90 via-zinc-950/50 to-transparent flex items-center p-8 md:p-16">
                    <div className="text-white max-w-lg space-y-4 animate-fade-in relative z-10 p-6 rounded-2xl border border-white/5 bg-black/20 mt-12 md:mt-0">
                      {slide.subtitle && (
                        <span className="inline-block px-4 py-1.5 bg-neo-cyan/10 border border-neo-cyan/30 text-neo-cyan text-xs font-black uppercase tracking-widest shadow-[0_0_15px_rgba(6,182,212,0.2)] mb-4 rounded-full">
                          {slide.subtitle}
                        </span>
                      )}

                      {slide.title && (
                        <h2 className="text-4xl md:text-5xl font-black leading-tight tracking-tighter mb-4 text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400 group-hover/slide:to-neo-cyan transition-colors duration-500">
                          {slide.title}
                        </h2>
                      )}

                      {slide.description && (
                        <p className="text-lg text-slate-300 md:text-xl font-medium mb-6">
                          {slide.description}
                        </p>
                      )}

                      {slide.cta && (
                        <button className="relative overflow-hidden inline-flex items-center justify-center px-8 py-3 bg-white/10 text-white font-bold rounded-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.2)] hover:bg-white/20 hover:shadow-neon-cyan border border-white/10 hover:border-neo-cyan transition-all uppercase tracking-widest text-sm group/btn active:scale-95 duration-300">
                          <span className="relative z-10">{slide.cta}</span>
                          <div className="absolute inset-0 bg-gradient-to-r from-neo-cyan to-neo-emerald opacity-0 group-hover/btn:opacity-20 transition-opacity duration-300" />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </a>
            ) : (
              <div className="w-full h-full relative">
                <img
                  src={slide.image}
                  alt={slide.alt || `Slide ${index + 1}`}
                  className="w-full h-full object-cover"
                  loading={index === 0 ? 'eager' : 'lazy'}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Navigation Arrows */}
      {showArrows && slides.length > 1 && (
        <>
          <button
            onClick={prevSlide}
            className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center bg-zinc-950/50 hover:bg-neo-cyan/20 border border-white/10 hover:border-neo-cyan/50 text-white rounded-full shadow-glass transition-all hover:scale-110 opacity-0 group-hover:opacity-100"
            aria-label="Previous slide"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <button
            onClick={nextSlide}
            className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center bg-zinc-950/50 hover:bg-neo-cyan/20 border border-white/10 hover:border-neo-cyan/50 text-white rounded-full shadow-glass transition-all hover:scale-110 opacity-0 group-hover:opacity-100"
            aria-label="Next slide"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        </>
      )}

      {/* Indicators */}
      {showIndicators && slides.length > 1 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-3 bg-zinc-950/50 px-4 py-2 rounded-full border border-white/10">
          {slides.map((_, index) => (
            <button
              key={index}
              onClick={() => goToSlide(index)}
              className={cn(
                'h-2 rounded-full transition-all duration-300',
                index === currentSlide
                  ? 'bg-neo-cyan w-8 shadow-[0_0_10px_rgba(6,182,212,0.8)]'
                  : 'bg-white/30 hover:bg-white/60 w-2'
              )}
              aria-label={`Go to slide ${index + 1}`}
              aria-current={index === currentSlide ? 'true' : 'false'}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default Carousel;
