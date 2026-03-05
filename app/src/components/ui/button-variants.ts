import { cva } from "class-variance-authority"

export const buttonVariants = cva(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
    {
        variants: {
            variant: {
                default: "bg-primary text-primary-foreground shadow-md hover:bg-primary/90 hover:shadow-lg transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0",
                destructive:
                    "bg-destructive text-white shadow-sm hover:bg-destructive/90 hover:shadow-md transition-all",
                outline:
                    "border-2 border-input bg-background shadow-xs hover:bg-accent hover:text-accent-foreground hover:border-accent transition-all duration-300",
                secondary:
                    "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80 hover:shadow transition-all",
                ghost:
                    "hover:bg-accent hover:text-accent-foreground transition-colors duration-200",
                link: "text-primary underline-offset-4 hover:underline transition-colors",
                "flipkart-yellow": "bg-flipkart-yellow text-flipkart-black font-semibold shadow-md hover:bg-[#ffdb1b] hover:shadow-lg transition-all duration-300 hover:-translate-y-0.5"
            },
            size: {
                default: "h-9 px-4 py-2 has-[>svg]:px-3",
                sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
                lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
                icon: "size-9",
                "icon-sm": "size-8",
                "icon-lg": "size-10",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    }
)
