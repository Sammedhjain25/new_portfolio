import { Laptop } from '../../3d_laptop';
import { Suspense } from 'react';

export default function LaptopDemo() {
    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#111' }}>
            <Suspense fallback={<div>Loading...</div>}>
                <Laptop />
            </Suspense>
        </div>
    );
}
