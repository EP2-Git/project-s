
import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    // Function to check if we're on mobile
    const checkMobile = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }

    // Add event listener
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)

    // Modern browsers
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener("change", checkMobile)
    }
    // Older browsers
    else if (typeof mql.addListener === 'function') {
      mql.addListener(checkMobile)
    }

    // Initial check
    checkMobile()

    // Cleanup event listener
    return () => {
      if (typeof mql.removeEventListener === 'function') {
        mql.removeEventListener("change", checkMobile)
      } else if (typeof mql.removeListener === 'function') {
        mql.removeListener(checkMobile)
      }
    }
  }, [])

  return !!isMobile
}
