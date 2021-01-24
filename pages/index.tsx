import Head from "next/head";
import React, {
  FC,
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
} from "react";
import { Container, Row, Col } from "react-bootstrap";
import { createWorker, PSM } from "tesseract.js";

import { AppContext, AppContextType } from "../components/AppContext";
import Layout from "../components/Layout";
import CodeMatrixTextBox from "../components/CodeMatrixTextBox";
import SequencesTextBox from "../components/SequencesTextBox";
import BufferSizeBox from "../components/BufferSizeBox";
import MainTitle from "../components/MainTitle";
import SolutionModal from "../components/SolutionModal";

import { SolverResult } from "../lib/bruter";
import * as CvService from "../services/cv";
import styles from "../styles/Index.module.scss";

const HackBox = () => (
  <div className={styles.hackbox}>
    <div className={styles.hackbox__header}>
      <div className={styles.hackbox__sequence}>2</div>
      <h3 className={styles.hackbox__header_text}>ENTER CODE MATRIX</h3>
    </div>
    <div className={styles.hackbox__inside}>
      <CodeMatrixTextBox />
    </div>
  </div>
);

const SequenceBox = () => (
  <div className={styles["sequence-box"]}>
    <div className={styles["sequence-box__header"]}>
      <div className={styles["sequence-box__sequence"]}>3</div>
      <h3 className={styles["sequence-box__header-text"]}>ENTER SEQUENCES</h3>
    </div>
    <div className={styles["sequence-box__inside"]}>
      <SequencesTextBox />
    </div>
  </div>
);

const parseMatrix = (str: string): number[][] =>
  str
    .trim()
    .split(/[(\n|\r\n)]/)
    .map((row) =>
      row
        .trim()
        .split(/\s+/)
        .map((n) => parseInt(n, 16))
    );

const HackButton: FC<{
  disabled?: boolean;
  onClick: () => void;
}> = ({ disabled, onClick }) => {
  const handleClick = useCallback(() => {
    onClick();
  }, [onClick]);
  return (
    <div className={styles["hack-button"]}>
      <button
        disabled={disabled}
        onClick={handleClick}
        className={styles["hack-button__button"]}
      >
        SOLVE
      </button>
    </div>
  );
};

const sendStats = async ({
  bufferSize,
  sequenceCount,
  sequencesMatched,
  solutionLength,
  matrixSize,
}) => {
  if (process.env.NEXT_PUBLIC_UA_ENABLED !== "true") {
    console.log("ne");
    console.log(process.env.NEXT_PUBLIC_UA_ENABLED);
    return null;
  } //ec, ea, el, ev

  const evs = [
    { ec: "Solver", ea: "Buffer size", el: `${bufferSize}`, ev: 1 },
    { ec: "Solver", ea: "Sequence count", el: `${sequenceCount}`, ev: 1 },
    {
      ec: "Solver",
      ea: "Sequences matched",
      el: `${sequencesMatched}`,
      ev: 1,
    },
    { ec: "Solver", ea: "Solution length", el: `${solutionLength}`, ev: 1 },
    { ec: "Solver", ea: "Matrix size", el: `${matrixSize}`, ev: 1 },
  ];

  try {
    return fetch(`/api/eventview`, {
      method: "POST",
      body: JSON.stringify({ dp: window.location.pathname, evs }),
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (e) {}
};

const Index = () => {
  const [matrixText, onMatrixChanged] = useState<string>("");
  const [sequencesText, onSequencesChanged] = useState<string>("");
  const [bufferSize, onBufferSizeChanged] = useState<number>(4);

  const cvWorkerRef = useRef<CvService.CvWorker>(null);
  const ocrWorkerRef = useRef<Tesseract.Worker>(null);

  useEffect(() => {
    const uniqChars = (arr) => [...new Set(arr.join("").split(""))];
    const getOcrWhitelist = () =>
      [" ", ...uniqChars(["1C", "55", "7A", "BD", "E9", "FF"])].join("");

    async function makeWorkers() {
      const cv = await CvService.createWorker();
      cv.worker.addEventListener("message", (e) => console.log("onmessage", e));
      cv.worker.addEventListener("error", (e) => console.error("onerror", e));
      await cv.load();
      console.log("CV worker loaded ");
      cvWorkerRef.current = cv;

      const ocrWorker = createWorker({
        langPath: "/ocr",
        gzip: true,
        logger: (msg) => {
          console.log("[tesseract] ", msg);
        },
        errorHandler: (err) => {
          console.error("[tesseract] ", err);
        },
      });

      console.log("loading worker");
      await ocrWorker.load();
      console.log("loading OCR language data");
      await ocrWorker.loadLanguage("eng");
      console.log("initializing OCR language data");
      await ocrWorker.initialize("eng");
      await ocrWorker.setParameters({
        tessedit_char_whitelist: getOcrWhitelist(),
        // @ts-ignore
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK, // if block doesn't work well enough, slice grids into columns
      });
      ocrWorkerRef.current = ocrWorker;
      console.log("OCR worker loaded");
    }

    makeWorkers();
  }, []);

  const outputCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const getFileImageData = (file: File) => {
      return new Promise<ImageData>((resolve, reject) => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        const img = document.createElement("img");
        img.onload = () => {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);

          const imageData = ctx.getImageData(0, 0, img.width, img.height);
          resolve(imageData);
        };
        img.onerror = () => {
          reject(new Error("Failed to load clipboard image!"));
        };

        const fr = new FileReader();
        fr.onload = () => {
          const dataUrl = fr.result as string;
          img.src = dataUrl;
        };
        fr.onerror = () => {
          reject(new Error("Failed to read file!"));
        };
        fr.readAsDataURL(file);
      });
    };

    async function processImage(imageData: ImageData) {
      console.log("processing screenshot");
      const output = await cvWorkerRef.current.processScreenshot(imageData);

      const ctx = outputCanvasRef.current.getContext("2d");
      const putImage = (img: ImageData) => {
        outputCanvasRef.current.width = img.width;
        outputCanvasRef.current.height = img.height;
        ctx.putImageData(img, 0, 0);
      };

      console.log("running OCR");
      console.log("OCRing code matrix");
      putImage(output.codeMatrix);
      const codeMatrix = await ocrWorkerRef.current.recognize(
        outputCanvasRef.current
      );
      console.log("%cCODE MATRIX OCR RESULT:", "color:#00ff00");
      console.log(codeMatrix.data);

      console.log("OCRing sequences");
      putImage(output.sequences);
      const sequences = await ocrWorkerRef.current.recognize(
        outputCanvasRef.current
      );
      console.log("%cSEQUENCES OCR RESULT:", "color:#00ff00");
      console.log(sequences.data);

      putImage(output.comboImage);
    }

    async function handlePaste(e: ClipboardEvent) {
      const items = e.clipboardData.items;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind !== "file" || !item.type.startsWith("image")) {
          continue;
        }

        console.log({
          i,
          kind: item.kind,
          type: item.type,
        });

        if (!ocrWorkerRef.current) {
          throw new Error("[debug] wait for ocr worker");
        }

        console.log("reading clipboard file");
        const file = item.getAsFile();
        console.log("getting file image data");
        const imageData = await getFileImageData(file);
        setTimeout(() => processImage(imageData), 0);

        e.preventDefault();
        return;
      }
    }

    window.addEventListener("paste", handlePaste);

    return () => {
      window.removeEventListener("paste", handlePaste);
    };
  }, []);

  const state = useMemo<AppContextType>(
    () => ({
      matrixText,
      onMatrixChanged,
      sequencesText,
      onSequencesChanged,
      bufferSize,
      onBufferSizeChanged,
    }),
    [
      matrixText,
      onMatrixChanged,
      sequencesText,
      onSequencesChanged,
      bufferSize,
      onBufferSizeChanged,
    ]
  );
  const stateRef = useRef(state);
  stateRef.current = state;

  const inputsEmpty = useMemo(
    () => sequencesText.trim().length === 0 && matrixText.trim().length === 0,
    [sequencesText, matrixText]
  );
  const [solverRunning, setSolverRunning] = useState<boolean>(false);
  const [codeMatrix, setCodeMatrix] = useState<number[][]>([]);
  const [allSequencesLen, setAllSequencesLen] = useState<number>(0);
  const [solution, setSolution] = useState<SolverResult | null>(null);
  const [solutionModalVisible, setSolutionModalVisible] = useState<boolean>(
    false
  );

  const handleHackButtonClick = useCallback(async () => {
    const { matrixText, sequencesText, bufferSize } = stateRef.current;
    console.log("start");
    setSolverRunning(true);

    setTimeout(async () => {
      const runSolver = (await import("../lib/bruter")).default;
      console.log("running");
      const matrix = parseMatrix(matrixText);
      const sequences = parseMatrix(sequencesText);
      console.log(matrix, sequences);
      const solution = runSolver(matrix, sequences, bufferSize);
      console.log(solution);

      sendStats({
        bufferSize: bufferSize,
        matrixSize: matrix[0].length,
        sequenceCount: sequences.length,
        sequencesMatched: solution.match.includes.length,
        solutionLength: solution.match.result.length,
      });

      setSolution(solution);
      setAllSequencesLen(sequences.length);
      setCodeMatrix(matrix);
      setSolutionModalVisible(true);
      setSolverRunning(false);
    }, 50);
  }, [
    stateRef,
    setSolution,
    setAllSequencesLen,
    setSolutionModalVisible,
    setSolverRunning,
    setCodeMatrix,
  ]);

  const onModalHide = useCallback(() => setSolutionModalVisible(false), [
    setSolutionModalVisible,
  ]);

  const [hasJS, setHasJS] = useState(false);
  useEffect(() => {
    setHasJS(true);
  }, []);

  return (
    <AppContext.Provider value={state}>
      <Layout>
        <Head>
          <title>Cyberpunk 2077 Hacking Minigame Solver</title>
          <meta
            property="og:title"
            content="Cyberpunk 2077 Hacking Minigame Solver"
          />
        </Head>

        <SolutionModal
          show={solutionModalVisible}
          onHide={onModalHide}
          result={solution}
          allSequencesLen={allSequencesLen}
          codeMatrix={codeMatrix}
        />

        <Container as="main" className={styles.main}>
          <Row>
            <Col>
              <MainTitle className={styles.title} />
              <h2 className={styles.description}>
                Instant Breach Protocol solver - start cracking, samurai.
              </h2>
            </Col>
          </Row>

          <Row>
            <Col lg={8}>
              <div className={styles["description-separator"]}></div>
            </Col>
          </Row>

          {!hasJS && (
            <noscript style={{ fontSize: "3rem", color: "red" }}>
              <Row>
                <Col lg={12}>
                  This application currently requires JavaScript to run.
                </Col>
              </Row>
            </noscript>
          )}

          <Row>
            <Col>
              <canvas ref={outputCanvasRef} />
            </Col>
          </Row>

          <Row>
            <Col lg={8}>
              <BufferSizeBox />
            </Col>
          </Row>

          <Row>
            <Col lg={8}>
              <HackBox />
            </Col>
            <Col lg={4}>
              <SequenceBox />
            </Col>
          </Row>

          <Row>
            <Col lg={8}>
              <HackButton
                disabled={solverRunning || inputsEmpty}
                onClick={handleHackButtonClick}
              />
            </Col>
          </Row>

          <Row className="mt-5">
            <Col lg={8}>
              <p>
                THIS APP IS NOT AFFILIATED WITH CD PROJEKT RED OR CYBERPUNK
                2077. TRADEMARK "CYBERPUNK 2077" IS OWNED BY CD PROJEKT S.A.
              </p>
            </Col>
          </Row>
        </Container>
      </Layout>
    </AppContext.Provider>
  );
};

export default Index;
