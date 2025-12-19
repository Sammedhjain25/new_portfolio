import earthModel from '~/assets/earth.glb';
import mwnx from '~/assets/milkyway-nx.hdr';
import mwny from '~/assets/milkyway-ny.hdr';
import mwnz from '~/assets/milkyway-nz.hdr';
import mwpx from '~/assets/milkyway-px.hdr';
import mwpy from '~/assets/milkyway-py.hdr';
import mwpz from '~/assets/milkyway-pz.hdr';
import milkywayBg from '~/assets/milkyway.jpg';
import { Loader } from '~/components/loader';
import { tokens } from '~/components/theme-provider/theme';
import { Transition } from '~/components/transition';
import { useReducedMotion } from 'framer-motion';
import { useInViewport, useWindowSize } from '~/hooks';
import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { HDRCubeTextureLoader, OrbitControls } from 'three-stdlib';
import {
  ACESFilmicToneMapping,
  AmbientLight,
  AnimationMixer,
  Clock,
  DirectionalLight,
  LoopRepeat,
  PMREMGenerator,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  WebGLRenderer,
} from 'three';
import { LinearFilter } from 'three';
import { EquirectangularReflectionMapping } from 'three';
import { msToNum } from '~/utils/style';
import {
  cleanRenderer,
  cleanScene,
  modelLoader,
  removeLights,
  textureLoader,
} from '~/utils/three';
import styles from './earth-project.module.css';

export const EarthProject = memo(({ visible, showDelay, onLoad }) => {
  const [loaded, setLoaded] = useState(false);
  const [loaderVisible, setLoaderVisible] = useState(false);
  const [showCutaway, setShowCutaway] = useState(false);
  const container = useRef();
  const canvas = useRef();
  const scene = useRef();
  const renderer = useRef();
  const camera = useRef();
  const clock = useRef();
  const sceneModel = useRef();
  const animations = useRef();
  const mixer = useRef();
  const controls = useRef();
  const envMap = useRef();
  const mounted = useRef();
  const animationFrame = useRef();
  const inViewport = useInViewport(canvas);
  const { width: windowWidth, height: windowHeight } = useWindowSize();
  const reduceMotion = useReducedMotion();

  const renderFrame = useCallback(() => {
    if (!inViewport || !loaded) {
      cancelAnimationFrame(animationFrame.current);
      return;
    }

    animationFrame.current = requestAnimationFrame(renderFrame);
    const delta = clock.current.getDelta();
    mixer.current.update(delta);
    controls.current.update();
    renderer.current.render(scene.current, camera.current);
  }, [inViewport, loaded]);

  useEffect(() => {
    mounted.current = true;
    const { innerWidth, innerHeight } = window;

    renderer.current = new WebGLRenderer({
      canvas: canvas.current,
      antialias: false,
      alpha: true,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: true,
    });
    renderer.current.setPixelRatio(1);
    renderer.current.outputColorSpace = SRGBColorSpace;
    renderer.current.toneMapping = ACESFilmicToneMapping;

    camera.current = new PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
    camera.current.position.set(0, 0, 2.6);
    camera.current.lookAt(0, 0, 0);

    scene.current = new Scene();
    clock.current = new Clock();

    const ambientLight = new AmbientLight(0x222222, 0.05);
    const dirLight = new DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(3, 0, 1);
    const lights = [ambientLight, dirLight];
    lights.forEach(light => scene.current.add(light));

    controls.current = new OrbitControls(camera.current, canvas.current);
    controls.current.enableZoom = false;
    controls.current.enablePan = false;
    controls.current.enableDamping = true;
    controls.current.dampingFactor = 0.05;
    controls.current.rotateSpeed = 0.3;
    controls.current.autoRotate = true;
    controls.current.autoRotateSpeed = 0.5;

    return () => {
      mounted.current = false;
      cancelAnimationFrame(animationFrame.current);
      removeLights(lights);
      cleanScene(scene.current);
      cleanRenderer(renderer.current);
    };
  }, []);

  useEffect(() => {
    if (loaded) return;

    const hdrLoader = new HDRCubeTextureLoader();
    const pmremGenerator = new PMREMGenerator(renderer.current);
    pmremGenerator.compileCubemapShader();

    const loadModel = async () => {
      const gltf = await modelLoader.loadAsync(earthModel);

      sceneModel.current = gltf.scene;
      animations.current = gltf.animations;
      mixer.current = new AnimationMixer(sceneModel.current);
      mixer.current.timeScale = 0.1;

      sceneModel.current.traverse(async child => {
        const { material, name } = child;

        if (name === 'Atmosphere') {
          material.alphaMap = material.map;
        }

        if (material) {
          await renderer.current.initTexture(material);
        }
      });

      sceneModel.current.position.set(0, 0, 0);
      sceneModel.current.scale.set(0.7, 0.7, 0.7);

      // Set initial mesh visibility
      sceneModel.current.traverse(child => {
        const { name } = child;
        if (name === 'Chunk' || name === 'EarthPartial') {
          child.visible = false;
        } else if (name === 'EarthFull' || name === 'Atmosphere') {
          child.visible = true;
        }
      });
    };

    const loadEnv = async () => {
      const hdrTexture = await hdrLoader.loadAsync([mwnx, mwny, mwnz, mwpx, mwpy, mwpz]);
      hdrTexture.magFilter = LinearFilter;
      envMap.current = pmremGenerator.fromCubemap(hdrTexture);
      pmremGenerator.dispose();
      await renderer.current.initTexture(envMap.current.texture);
    };

    const loadBackground = async () => {
      // Remove background - keep transparent
      scene.current.background = null;
    };

    const handleLoad = async () => {
      await Promise.all([loadBackground(), loadEnv(), loadModel()]);

      sceneModel.current.traverse(({ material }) => {
        if (material) {
          material.envMap = envMap.current.texture;
          material.needsUpdate = true;
        }
      });

      scene.current.add(sceneModel.current);

      // Start the rotation animation
      if (animations.current.length > 0) {
        const animation = mixer.current.clipAction(animations.current[0]);
        animation.setLoop(LoopRepeat, Infinity);
        animation.play();
      }

      if (mounted.current) {
        setLoaded(true);
        onLoad?.();
      }
    };

    startTransition(() => {
      handleLoad();
      setTimeout(() => {
        setLoaderVisible(true);
      }, 1000);
    });
  }, [loaded, onLoad]);

  useEffect(() => {
    if (loaded && inViewport) {
      renderFrame();
    }

    return () => {
      cancelAnimationFrame(animationFrame.current);
    };
  }, [renderFrame, inViewport, loaded]);

  useEffect(() => {
    if (windowWidth <= 768) {
      controls.current.enabled = false;
    } else {
      controls.current.enabled = true;
    }
  }, [windowWidth]);

  useEffect(() => {
    renderer.current.setSize(windowWidth, windowHeight);
    camera.current.aspect = windowWidth / windowHeight;
    camera.current.updateProjectionMatrix();
  }, [windowWidth, windowHeight]);

  // Handle click to toggle cutaway view
  useEffect(() => {
    const handleClick = () => {
      if (!loaded) return;
      
      setShowCutaway(!showCutaway);
      
      // Update mesh visibility
      sceneModel.current.traverse(child => {
        const { name } = child;
        if (showCutaway) {
          // Show full Earth
          if (name === 'EarthFull' || name === 'Atmosphere') {
            child.visible = true;
          } else if (name === 'Chunk' || name === 'EarthPartial') {
            child.visible = false;
          }
        } else {
          // Show cutaway view
          if (name === 'EarthPartial' || name === 'Chunk') {
            child.visible = true;
          } else if (name === 'EarthFull') {
            child.visible = false;
          }
        }
      });
      
      // Update camera position
      if (showCutaway) {
        // Move to full Earth view
        camera.current.position.set(0, 0, 2.6);
      } else {
        // Move to cutaway view
        camera.current.position.set(0.37, 1.02, 1.84);
      }
    };

    const currentCanvas = canvas.current;
    if (currentCanvas) {
      currentCanvas.addEventListener('click', handleClick);
      currentCanvas.style.cursor = 'pointer';
    }

    return () => {
      if (currentCanvas) {
        currentCanvas.removeEventListener('click', handleClick);
      }
    };
  }, [loaded, showCutaway]);

  return (
    <div className={styles.earthContainer}>
      <div className={styles.viewport}>
        <canvas
          className={styles.canvas}
          data-visible={loaded && visible}
          ref={canvas}
        />
        <div className={styles.vignette} />
      </div>
      <Transition
        unmount
        in={!loaded && loaderVisible}
        timeout={msToNum(tokens.base.durationL)}
      >
        {visible => (
          <div className={styles.loader} data-visible={visible}>
            <Loader />
          </div>
        )}
      </Transition>
    </div>
  );
});
