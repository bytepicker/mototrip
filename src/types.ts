export type Category = 'start' | 'finish' | 'waypoint' | 'sight' | 'fuel' | 'camp' | 'shop' | 'food' | 'service'
export type Point = { id: string; name: string; lat: number; lon: number; category: Category; note: string }
export type Trip = { id: string; name: string; description: string; updatedAt: number; points: Point[] }
