/**
 * 별지 서식 PDF 내려받기
 *
 * 화면 폼과 별개로, 참고 PDF·별지 이미지와 같은 «공문서» 톤(명조·회색라벨·검정테두리)으로
 * HTML을 그린 뒤 고해상도 캡처 → A4 PDF 저장한다.
 * (한글 .hwp 바이너리 생성은 불가. 웹에서 가능한 범위로 서식 스타일을 맞춤.)
 */

const FORMAL_SERIF =
  '"Nanum Myeongjo", "나눔명조", Batang, "바탕", "Noto Serif KR", "Apple Myungjo", serif';

const LABEL_BG = '#d9d9d9';
const SUB_BG = '#ececec';

function safeFileBase(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 80);
}

/** 나눔명조 로드 (공문서 명조 톤) — 캡처 전 반드시 대기 */
async function ensureFormalFonts(): Promise<void> {
  const id = 'ggnr-formal-doc-font';
  if (!document.getElementById(id)) {
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href =
      'https://fonts.googleapis.com/css2?family=Nanum+Myeongjo:wght@400;700&display=swap';
    document.head.appendChild(link);
  }
  // stylesheet + font face 준비
  try {
    await document.fonts.load(`700 18px ${FORMAL_SERIF}`);
    await document.fonts.load(`400 12px ${FORMAL_SERIF}`);
    await document.fonts.ready;
  } catch {
    /* 오프라인 등 — Batang 폴백 */
  }
  // 네트워크 폰트 한 틱 더
  await new Promise((r) => setTimeout(r, 80));
}

/** 별지 공통 표 스타일 (참고 PDF·별지 PNG 기준) */
export function formalDocSharedCss(): string {
  return `
    .fd-root{font-family:${FORMAL_SERIF};color:#000;-webkit-font-smoothing:antialiased}
    .fd-form-no{font-size:11px;margin:0 0 6px;font-weight:400;letter-spacing:0}
    .fd-title{text-align:center;font-size:20px;font-weight:700;margin:0 0 14px;
      padding-bottom:8px;border-bottom:1.5px solid #000;letter-spacing:0.02em;line-height:1.35}
    .fd-table{width:100%;border-collapse:collapse;table-layout:fixed;border:1px solid #000}
    .fd-table th,.fd-table td{border:1px solid #000;padding:0;vertical-align:middle;
      font-size:12.5px;line-height:1.35;color:#000;font-weight:400}
    .fd-table th{background:${LABEL_BG};font-weight:700;text-align:center;vertical-align:middle}
    .fd-sub{background:${SUB_BG};font-weight:700;text-align:center;font-size:12px;vertical-align:middle}
    .fd-sec{background:${LABEL_BG};font-weight:700;text-align:center;font-size:13.5px;vertical-align:middle}
    /* 라벨·값 모두 칸 안 가로·세로 정중앙 (rowspan 칸 포함) */
    .fd-cell{display:flex;align-items:center;justify-content:center;box-sizing:border-box;
      width:100%;min-height:36px;height:100%;padding:8px 6px;text-align:center;line-height:1.35}
    .fd-cell-rs2{min-height:72px}
    .fd-cell-rs3{min-height:108px}
    .fd-cell-left{display:flex;align-items:center;justify-content:flex-start;box-sizing:border-box;
      width:100%;min-height:36px;height:100%;padding:8px 10px;text-align:left;line-height:1.35}
    .fd-check .fd-cell-left,.fd-check{text-align:left;padding-left:0;letter-spacing:0.02em}
    .fd-tall .fd-cell-left{min-height:58px}
    .fd-xtall .fd-cell-left{min-height:96px;align-items:flex-start}
    .fd-guide{font-size:11.5px;line-height:1.65;padding:12px 16px;text-align:left}
    .fd-guide ol{margin:0;padding-left:1.25em}
    .fd-map{vertical-align:top}
    .fd-map .fd-cell-left{align-items:flex-start;min-height:220px}
  `;
}

/**
 * 서식 HTML을 A4 PDF로 저장.
 * 명조체 로드 후 PNG(고해상도)로 캡처해 글씨·선이 흐려지지 않게 한다.
 */
export async function downloadHtmlAsPdf(
  htmlInner: string,
  fileName: string,
  opts?: {
    title?: string;
    /** false면 A4 최소높이 강제 안 함(표 칸이 늘어나 글자가 아래로 밀리는 현상 방지) */
    fillA4Height?: boolean;
    letterRendering?: boolean;
  }
): Promise<void> {
  await ensureFormalFonts();

  const { default: html2canvas } = await import('html2canvas');
  const { jsPDF } = await import('jspdf');
  const fillA4Height = opts?.fillA4Height !== false;
  const letterRendering = opts?.letterRendering !== false;

  const host = document.createElement('div');
  host.setAttribute('data-formal-pdf-root', '1');
  host.style.cssText = [
    'position:fixed',
    'left:-10000px',
    'top:0',
    'width:794px',
    'background:#fff',
    'color:#000',
    'z-index:-1',
    'pointer-events:none',
  ].join(';');

  // A4 @96dpi ≈ 794×1123, 여백 ≈ 한글 서식(약 18~20mm)
  host.innerHTML = `
    <div class="formal-pdf-page fd-root" style="
      box-sizing:border-box;
      width:794px;
      ${fillA4Height ? 'min-height:1123px;' : 'min-height:0;height:auto;'}
      padding:52px 56px 48px;
      font-family:${FORMAL_SERIF};
      font-size:12.5px;
      line-height:1.45;
      color:#000;
      background:#fff;
    ">
      ${htmlInner}
    </div>
  `;
  document.body.appendChild(host);

  try {
    const page = host.querySelector('.formal-pdf-page') as HTMLElement;
    await document.fonts.ready;

    /** data URL·외부 이미지가 로드된 뒤 캡처해야 PDF에 위치도가 남음 */
    const imgs = Array.from(page.querySelectorAll('img'));
    await Promise.all(
      imgs.map(
        (img) =>
          new Promise<void>((resolve) => {
            if (img.complete && img.naturalWidth > 0) {
              resolve();
              return;
            }
            img.onload = () => resolve();
            img.onerror = () => resolve();
            window.setTimeout(() => resolve(), 4000);
          })
      )
    );

    const canvas = await html2canvas(page, {
      scale: 3,
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#ffffff',
      logging: false,
      windowWidth: 794,
      onclone: (doc) => {
        const cloned = doc.querySelector('.formal-pdf-page') as HTMLElement | null;
        if (cloned) {
          cloned.style.fontFamily = FORMAL_SERIF;
          if (letterRendering) {
            cloned.style.textRendering = 'geometricPrecision';
          }
          /** width:auto 만 주면 클론에서 0×0 되는 경우 방지 — 실제 픽셀 크기로 고정 */
          cloned.querySelectorAll('img').forEach((img) => {
            const el = img as HTMLImageElement;
            const nw = el.naturalWidth || 0;
            const nh = el.naturalHeight || 0;
            if (nw > 0 && nh > 0) {
              const maxW = 480;
              const w = Math.min(nw, maxW);
              const h = Math.round((nh / nw) * w);
              el.style.width = `${w}px`;
              el.style.height = `${h}px`;
              el.style.maxWidth = '100%';
              el.style.objectFit = 'contain';
            }
          });
        }
      },
    });

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgW = pageW;
    const imgH = (canvas.height * pageW) / canvas.width;
    // PNG — JPEG 대비 글자·선 선명
    const imgData = canvas.toDataURL('image/png');

    let heightLeft = imgH;
    let position = 0;
    pdf.addImage(imgData, 'PNG', 0, position, imgW, imgH, undefined, 'FAST');
    heightLeft -= pageH;

    while (heightLeft > 1) {
      position = heightLeft - imgH;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgW, imgH, undefined, 'FAST');
      heightLeft -= pageH;
    }

    if (opts?.title) {
      pdf.setProperties({ title: opts.title });
    }

    const base = safeFileBase(fileName);
    pdf.save(base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`);
  } finally {
    host.remove();
  }
}

export function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export { LABEL_BG, SUB_BG };
