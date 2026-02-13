# Modern Minimalistic Design System

This document outlines the enhanced design system implemented for the USB Monitor application.

## Color Palette

### Light Mode
- **Primary**: Blue tones (oklch(0.52 0.14 245))
- **Accent**: Lighter blue (oklch(0.58 0.12 250))
- **Background**: Near-white (oklch(0.98 0.002 240))
- **Card**: Pure white with subtle blue tint (oklch(0.995 0.001 240))
- **Muted**: Light gray-blue (oklch(0.96 0.004 240))

### Dark Mode
- **Primary**: Bright blue (oklch(0.62 0.14 245))
- **Accent**: Mid blue (oklch(0.58 0.12 250))
- **Background**: Deep blue-black (oklch(0.12 0.012 240))
- **Card**: Slightly lighter blue-black (oklch(0.16 0.014 240))
- **Muted**: Dark gray-blue (oklch(0.20 0.012 240))

## Animations & Transitions

### Global Transitions
All elements have smooth 300ms transitions for:
- Background colors
- Border colors
- Text colors
- Box shadows

### Component-Specific Animations

#### Cards
- **Hover Effect**: Slight upward translation (-2px) with enhanced shadow
- **Entry Animation**: Fade-in with stagger effect
- **Duration**: 300ms with ease-out cubic-bezier

#### Buttons
- **Hover Effect**: Shadow elevation from sm to md
- **Active State**: Scale down to 98%
- **Transitions**: All properties animated at 200ms

#### Inputs
- **Focus State**: 
  - Ring appears with 40% opacity primary color
  - Border transitions to primary/50
  - Background becomes solid
- **Hover**: Border color transitions
- **Duration**: 200ms ease

#### Login Page
- **Background**: Animated gradient orbs with pulse effect
- **Card Entry**: Scale and translate animation over 600ms
- **Form Fields**: Staggered appearance (0.3s, 0.4s, 0.5s delays)
- **Error Messages**: Height and opacity animation

## Loading States

### Spinner Component
- **Design**: Dual-ring with counter-rotating arcs
- **Colors**: Primary and accent gradients
- **Center**: Pulsing gradient dot
- **Animation**: 
  - Outer ring: 0.8s cubic-bezier rotation
  - Inner ring: 1.2s reverse rotation
  - Center: 2s pulse

### Skeleton Loader
- **Base**: Semi-transparent muted background
- **Shimmer**: Gradient sweep animation over 2s
- **Effect**: Creates a scanning light appearance

## Utility Classes

### Glass Morphism
```css
.glass-effect
```
Creates frosted glass effect with backdrop blur

### Gradient Backgrounds
```css
.gradient-primary
```
Premium blue gradient (changes based on theme)

### Hover Lift
```css
.hover-lift
```
Lifts element 2px on hover with shadow enhancement

### Animations
- `.fade-in`: Opacity and translate-y animation
- `.pulse-subtle`: Gentle opacity pulsing
- `.shimmer`: Loading shimmer effect
- `.smooth-scroll`: Smooth scrolling behavior

### Shadows
- `.card-shadow`: Modern subtle shadow for cards (theme-aware)

## Best Practices

1. **Transitions**: Use cubic-bezier(0.4, 0, 0.2, 1) for natural motion
2. **Delays**: Stagger animations by 0.1s increments for sequential reveals
3. **Duration**: 
   - Quick interactions: 200ms
   - Standard transitions: 300ms
   - Entry animations: 400-600ms
4. **Opacity**: Use semi-transparent overlays (0.05-0.15) for depth
5. **Shadows**: Combine multiple shadows for depth (sm + lg)

## Performance

All animations are GPU-accelerated using:
- `transform` instead of `top/left`
- `opacity` for visibility changes
- `will-change` avoided unless critical
- Transitions limited to properties that don't trigger layout

## Accessibility

- All animations respect `prefers-reduced-motion`
- Color contrast meets WCAG AA standards
- Focus states are clearly visible
- Interactive elements have minimum 44px touch targets
