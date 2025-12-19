import { animate, useReducedMotion, useSpring } from 'framer-motion';
import { useInViewport } from './hooks';
import {
    createRef,
    startTransition,
    useCallback,
    useEffect,
    useRef,
    useState,
} from 'react';
import {
    AmbientLight,
    Color,
    DirectionalLight,
    Group,
    MathUtils,
    Mesh,
    MeshBasicMaterial,
    MeshDepthMaterial,
    OrthographicCamera,
    PerspectiveCamera,
    PlaneGeometry,
    SRGBColorSpace,
    Scene,
    ShaderMaterial,
    Vector3,
    WebGLRenderTarget,
    WebGLRenderer,
} from 'three';
import { HorizontalBlurShader, VerticalBlurShader } from 'three-stdlib';
import { resolveSrcFromSrcSet, classes, cssProps, numToMs, throttle } from './utils';
import {
    cleanRenderer,
    cleanScene,
    modelLoader,
    removeLights,
    textureLoader,
} from './three-utils';
import macbookPro from './macbook-pro.glb';
import styles from './laptop.module.css';

const MeshType = {
    Frame: 'Frame',
    Logo: 'Logo',
    Screen: 'Screen',
};

const rotationSpringConfig = {
    stiffness: 40,
    damping: 20,
    mass: 1.4,
    restSpeed: 0.001,
};

export const Laptop = ({
    show = true,
    showDelay = 0,
    cameraPosition = { x: 0, y: 0, z: 8 },
    style,
    className,
    onLoad,
    texture, // Optional texture for the screen
    ...rest
}) => {
    const [loaded, setLoaded] = useState(false);
    const container = useRef();
    const canvas = useRef();
    const camera = useRef();
    const modelGroup = useRef();
    const scene = useRef();
    const renderer = useRef();
    const shadowGroup = useRef();
    const renderTarget = useRef();
    const renderTargetBlur = useRef();
    const shadowCamera = useRef();
    const depthMaterial = useRef();
    const horizontalBlurMaterial = useRef();
    const verticalBlurMaterial = useRef();
    const plane = useRef();
    const lights = useRef();
    const blurPlane = useRef();
    const fillPlane = useRef();
    const isInViewport = useInViewport(container, false, { threshold: 0.2 });
    const reduceMotion = useReducedMotion();
    const rotationX = useSpring(0, rotationSpringConfig);
    const rotationY = useSpring(0, rotationSpringConfig);

    useEffect(() => {
        const { clientWidth, clientHeight } = container.current;

        renderer.current = new WebGLRenderer({
            canvas: canvas.current,
            alpha: true,
            antialias: false,
            powerPreference: 'high-performance',
            failIfMajorPerformanceCaveat: true,
        });

        renderer.current.setPixelRatio(2);
        renderer.current.setSize(clientWidth, clientHeight);
        renderer.current.outputColorSpace = SRGBColorSpace;

        camera.current = new PerspectiveCamera(36, clientWidth / clientHeight, 0.1, 100);
        camera.current.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z);
        scene.current = new Scene();

        modelGroup.current = new Group();
        scene.current.add(modelGroup.current);

        // Lighting
        const ambientLight = new AmbientLight(0xffffff, 1.2);
        const keyLight = new DirectionalLight(0xffffff, 1.1);
        const fillLight = new DirectionalLight(0xffffff, 0.8);

        fillLight.position.set(-6, 2, 2);
        keyLight.position.set(0.5, 0, 0.866);
        lights.current = [ambientLight, keyLight, fillLight];
        lights.current.forEach(light => scene.current.add(light));

        // The shadow container
        shadowGroup.current = new Group();
        scene.current.add(shadowGroup.current);
        shadowGroup.current.position.set(0, 0, -0.8);
        shadowGroup.current.rotateX(Math.PI / 2);

        const renderTargetSize = 512;
        const planeWidth = 8;
        const planeHeight = 8;
        const cameraHeight = 1.5;
        const shadowOpacity = 0.8;
        const shadowDarkness = 3;

        renderTarget.current = new WebGLRenderTarget(renderTargetSize, renderTargetSize);
        renderTarget.current.texture.generateMipmaps = false;

        renderTargetBlur.current = new WebGLRenderTarget(renderTargetSize, renderTargetSize);
        renderTargetBlur.current.texture.generateMipmaps = false;

        const planeGeometry = new PlaneGeometry(planeWidth, planeHeight).rotateX(Math.PI / 2);

        const planeMaterial = new MeshBasicMaterial({
            map: renderTarget.current.texture,
            opacity: shadowOpacity,
            transparent: true,
        });

        plane.current = new Mesh(planeGeometry, planeMaterial);
        plane.current.scale.y = -1;
        shadowGroup.current.add(plane.current);

        blurPlane.current = new Mesh(planeGeometry);
        blurPlane.current.visible = false;
        shadowGroup.current.add(blurPlane.current);

        const fillMaterial = new MeshBasicMaterial({
            color: 0xffffff,
            opacity: 0,
            transparent: true,
        });

        fillPlane.current = new Mesh(planeGeometry, fillMaterial);
        fillPlane.current.rotateX(Math.PI);
        fillPlane.current.position.y -= 0.00001;
        shadowGroup.current.add(fillPlane.current);

        shadowCamera.current = new OrthographicCamera(
            -planeWidth / 2,
            planeWidth / 2,
            planeHeight / 2,
            -planeHeight / 2,
            0,
            cameraHeight
        );
        shadowCamera.current.rotation.x = Math.PI / 2;
        shadowGroup.current.add(shadowCamera.current);

        depthMaterial.current = new MeshDepthMaterial();
        depthMaterial.current.userData.darkness = { value: shadowDarkness };
        depthMaterial.current.onBeforeCompile = shader => {
            shader.uniforms.darkness = depthMaterial.current.userData.darkness;
            shader.fragmentShader = `
        uniform float darkness;
        ${shader.fragmentShader.replace(
                'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
                'gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * darkness );'
            )}
      `;
        };
        depthMaterial.current.depthTest = false;
        depthMaterial.current.depthWrite = false;

        horizontalBlurMaterial.current = new ShaderMaterial(HorizontalBlurShader);
        horizontalBlurMaterial.current.depthTest = false;

        verticalBlurMaterial.current = new ShaderMaterial(VerticalBlurShader);
        verticalBlurMaterial.current.depthTest = false;

        const unsubscribeX = rotationX.on('change', renderFrame);
        const unsubscribeY = rotationY.on('change', renderFrame);

        return () => {
            renderTarget.current.dispose();
            renderTargetBlur.current.dispose();
            removeLights(lights.current);
            cleanScene(scene.current);
            cleanRenderer(renderer.current);
            unsubscribeX();
            unsubscribeY();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const blurShadow = useCallback(amount => {
        blurPlane.current.visible = true;

        blurPlane.current.material = horizontalBlurMaterial.current;
        blurPlane.current.material.uniforms.tDiffuse.value = renderTarget.current.texture;
        horizontalBlurMaterial.current.uniforms.h.value = amount * (1 / 256);

        renderer.current.setRenderTarget(renderTargetBlur.current);
        renderer.current.render(blurPlane.current, shadowCamera.current);

        blurPlane.current.material = verticalBlurMaterial.current;
        blurPlane.current.material.uniforms.tDiffuse.value = renderTargetBlur.current.texture;
        verticalBlurMaterial.current.uniforms.v.value = amount * (1 / 256);

        renderer.current.setRenderTarget(renderTarget.current);
        renderer.current.render(blurPlane.current, shadowCamera.current);

        blurPlane.current.visible = false;
    }, []);

    const renderFrame = useCallback(() => {
        const blurAmount = 5;

        const initialBackground = scene.current.background;
        scene.current.background = null;

        scene.current.overrideMaterial = depthMaterial.current;

        renderer.current.setRenderTarget(renderTarget.current);
        renderer.current.render(scene.current, shadowCamera.current);

        scene.current.overrideMaterial = null;

        blurShadow(blurAmount);
        blurShadow(blurAmount * 0.4);

        renderer.current.setRenderTarget(null);
        scene.current.background = initialBackground;

        modelGroup.current.rotation.x = rotationX.get();
        modelGroup.current.rotation.y = rotationY.get();

        renderer.current.render(scene.current, camera.current);
    }, [blurShadow, rotationX, rotationY]);

    useEffect(() => {
        const onMouseMove = throttle(event => {
            const { innerWidth, innerHeight } = window;

            const position = {
                x: (event.clientX - innerWidth / 2) / innerWidth,
                y: (event.clientY - innerHeight / 2) / innerHeight,
            };

            rotationY.set(position.x / 2);
            rotationX.set(position.y / 2);
        }, 100);

        if (isInViewport && !reduceMotion) {
            window.addEventListener('mousemove', onMouseMove);
        }

        return () => {
            window.removeEventListener('mousemove', onMouseMove);
        };
    }, [isInViewport, reduceMotion, rotationX, rotationY]);

    useEffect(() => {
        const handleResize = () => {
            if (!container.current) return;

            const { clientWidth, clientHeight } = container.current;

            renderer.current.setSize(clientWidth, clientHeight);
            camera.current.aspect = clientWidth / clientHeight;
            camera.current.updateProjectionMatrix();

            renderFrame();
        };

        window.addEventListener('resize', handleResize);
        handleResize();

        return () => {
            window.removeEventListener('resize', handleResize);
        };
    }, [renderFrame]);

    return (
        <div
            className={classes(styles.model, className)}
            data-loaded={loaded}
            style={cssProps({ delay: numToMs(showDelay) }, style)}
            ref={container}
            role="img"
            {...rest}
        >
            <canvas className={styles.canvas} ref={canvas} />
            <LaptopDevice
                renderer={renderer}
                modelGroup={modelGroup}
                show={show}
                showDelay={showDelay}
                renderFrame={renderFrame}
                setLoaded={setLoaded}
                onLoad={onLoad}
                texture={texture}
            />
        </div>
    );
};

const LaptopDevice = ({
    renderer,
    modelGroup,
    renderFrame,
    showDelay,
    setLoaded,
    onLoad,
    show,
    texture: screenTexture,
}) => {
    const [loadDevice, setLoadDevice] = useState();
    const reduceMotion = useReducedMotion();
    const placeholderScreen = createRef();

    useEffect(() => {
        const applyScreenTexture = async (texture, node) => {
            texture.colorSpace = SRGBColorSpace;
            texture.flipY = false;
            texture.anisotropy = renderer.current.capabilities.getMaxAnisotropy();
            texture.generateMipmaps = false;

            await renderer.current.initTexture(texture);

            node.material.color = new Color(0xffffff);
            node.material.transparent = true;
            node.material.map = texture;
        };

        const load = async () => {
            const url = macbookPro;
            let loadFullResTexture;
            let playAnimation;

            // Load model
            const gltf = await modelLoader.loadAsync(url);
            modelGroup.current.add(gltf.scene);

            gltf.scene.traverse(async node => {
                if (node.material) {
                    node.material.color = new Color(0x1f2025);
                }

                if (node.name === MeshType.Screen && screenTexture) {
                    // Handle screen texture if provided
                    placeholderScreen.current = node.clone();
                    placeholderScreen.current.material = node.material.clone();
                    node.parent.add(placeholderScreen.current);
                    placeholderScreen.current.material.opacity = 1;
                    placeholderScreen.current.position.z += 0.001;

                    if (screenTexture.placeholder) {
                        const placeholder = await textureLoader.loadAsync(screenTexture.placeholder);
                        applyScreenTexture(placeholder, placeholderScreen.current);
                    }

                    loadFullResTexture = async () => {
                        const image = await resolveSrcFromSrcSet(screenTexture);
                        const fullSize = await textureLoader.loadAsync(image);
                        await applyScreenTexture(fullSize, node);

                        animate(1, 0, {
                            onUpdate: value => {
                                placeholderScreen.current.material.opacity = value;
                                renderFrame();
                            },
                        });
                    };
                }
            });

            const targetPosition = new Vector3(0, 0, 0);

            if (reduceMotion) {
                gltf.scene.position.set(...targetPosition.toArray());
            }

            // Laptop open animation
            playAnimation = () => {
                const frameNode = gltf.scene.children.find(
                    node => node.name === MeshType.Frame
                );
                const startRotation = new Vector3(MathUtils.degToRad(90), 0, 0);
                const endRotation = new Vector3(0, 0, 0);

                gltf.scene.position.set(...targetPosition.toArray());
                frameNode.rotation.set(...startRotation.toArray());

                return animate(startRotation.x, endRotation.x, {
                    type: 'spring',
                    delay: (300 + showDelay + 300) / 1000,
                    stiffness: 80,
                    damping: 20,
                    restSpeed: 0.0001,
                    restDelta: 0.0001,
                    onUpdate: value => {
                        frameNode.rotation.x = value;
                        renderFrame();
                    },
                });
            };

            return { loadFullResTexture, playAnimation };
        };

        setLoadDevice({ start: load });
    }, [renderer, modelGroup, renderFrame, screenTexture, reduceMotion, showDelay]);

    useEffect(() => {
        if (!loadDevice || !show) return;
        let animation;

        const onModelLoad = async () => {
            const { loadFullResTexture, playAnimation } = await loadDevice.start();

            setLoaded(true);
            onLoad?.();

            if (!reduceMotion) {
                animation = playAnimation();
            }

            if (loadFullResTexture) {
                await loadFullResTexture();
            }

            if (reduceMotion) {
                renderFrame();
            }
        };

        startTransition(() => {
            onModelLoad();
        });

        return () => {
            animation?.stop();
        };
    }, [loadDevice, show, reduceMotion, setLoaded, onLoad, renderFrame]);

    return null;
};
