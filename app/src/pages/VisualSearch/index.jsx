import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  Camera,
  ClipboardPaste,
  Link2,
  Loader2,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  XCircle,
} from 'lucide-react';
import { useMarket } from '@/context/MarketContext';
import { useStableIcuMessages } from '@/i18n/useStableIcuMessages';
import { productApi } from '@/services/api';
import { cn } from '@/lib/utils';
import { formatBasePrice, formatEntityPrice } from '@/utils/pricing';
import { toSafePreviewImage } from '@/utils/visualSearchPreview';

import { StableText } from '@/i18n/StableText';
const QUICK_HINTS = [
  'iPhone 15 Pro Max titanium',
  'gaming laptop rtx',
  'air fryer stainless steel',
  'running shoes nike',
  'smart watch amoled',
  'noise cancelling earbuds',
];
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/gif', 'image/jpeg', 'image/png', 'image/webp']);

const extractProductId = (product) => product?.id || product?._id || null;

const getPrimaryImage = (product) => {
  if (!product) return '';
  if (Array.isArray(product.image)) return product.image[0] || '';
  if (Array.isArray(product.images)) return product.images[0] || '';
  return product.image || product.images || '';
};

const deriveFileNameFromUrl = (value = '') => {
  try {
    const pathname = new URL(value).pathname || '';
    return pathname.split('/').filter(Boolean).pop() || '';
  } catch {
    return '';
  }
};

const toSafeLimit = (value, fallback = 12) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(24, Math.max(4, Math.trunc(parsed)));
};

const confidenceTone = (score = 0) => {
  if (score >= 0.7) return 'border-neo-emerald/45 bg-neo-emerald/15 text-neo-emerald';
  if (score >= 0.45) return 'border-amber-400/45 bg-amber-400/15 text-amber-300';
  return 'border-neo-rose/45 bg-neo-rose/15 text-neo-rose';
};

const authenticityTone = (verdict = 'verify') => {
  if (verdict === 'likely_authentic') return 'border-neo-emerald/45 bg-neo-emerald/15 text-neo-emerald';
  if (verdict === 'high_risk') return 'border-neo-rose/45 bg-neo-rose/15 text-neo-rose';
  return 'border-amber-400/45 bg-amber-400/15 text-amber-300';
};

const authenticityLabel = (verdict = 'verify') => {
  if (verdict === 'likely_authentic') return 'Likely Authentic';
  if (verdict === 'high_risk') return 'High Risk';
  return 'Verify';
};

const priceGapTone = (position = 'near') => {
  if (position === 'below') return 'border-neo-emerald/35 bg-neo-emerald/10 text-neo-emerald';
  if (position === 'above') return 'border-neo-rose/35 bg-neo-rose/10 text-neo-rose';
  return 'border-white/20 bg-white/10 text-slate-200';
};

const summarizePriceGap = (priceGap, formatAmount) => {
  if (!priceGap || Number(priceGap.medianPrice || 0) <= 0) return 'No median baseline';
  const amount = Number(priceGap.againstMedianAmount || 0);
  if (amount === 0) return 'At median price';
  return `${formatAmount(Math.abs(amount))} ${amount < 0 ? 'below' : 'above'} median`;
};

const readImageDimensions = (file) =>
  new Promise((resolve) => {
    const previewUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const width = Number(image.naturalWidth || image.width || 0) || undefined;
      const height = Number(image.naturalHeight || image.height || 0) || undefined;
      URL.revokeObjectURL(previewUrl);
      resolve({ width, height });
    };
    image.onerror = () => {
      URL.revokeObjectURL(previewUrl);
      resolve({ width: undefined, height: undefined });
    };
    image.src = previewUrl;
  });

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });

const formatSize = (sizeBytes = 0) => {
  const size = Number(sizeBytes) || 0;
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(2)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
};

const VisualSearch = () => {
  const navigate = useNavigate();
  const { formatPrice, t: legacyT } = useMarket();
  const t = useStableIcuMessages(legacyT);
  const [searchParams] = useSearchParams();
  const bootstrappedFromQueryRef = useRef(false);
  const fileInputRef = useRef(null);

  const [imageUrl, setImageUrl] = useState('');
  const [imageDataUrl, setImageDataUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [hints, setHints] = useState('');
  const [imageMeta, setImageMeta] = useState(null);
  const [uploadedPreview, setUploadedPreview] = useState('');
  const [limit, setLimit] = useState(12);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tokens, setTokens] = useState([]);
  const [derivedKeyword, setDerivedKeyword] = useState('');
  const [matches, setMatches] = useState([]);
  const [total, setTotal] = useState(0);
  const [marketSnapshot, setMarketSnapshot] = useState(null);

  const previewImage = useMemo(() => toSafePreviewImage(imageUrl) || toSafePreviewImage(uploadedPreview), [imageUrl, uploadedPreview]);
  const formatBrowseAmount = useCallback(
    (amount) => formatBasePrice(formatPrice, amount),
    [formatPrice]
  );

  const clearUploadedPreview = useCallback(() => {
    setUploadedPreview((previous) => {
      if (previous && previous.startsWith('blob:')) {
        URL.revokeObjectURL(previous);
      }
      return '';
    });
    setImageDataUrl('');
    setImageMeta(null);
  }, []);

  const applyImageFile = useCallback(async (file, source = 'upload') => {
    if (!file) return;
    if (!ALLOWED_IMAGE_MIME_TYPES.has(String(file.type || '').toLowerCase())) {
      setError(t('visualSearch.error.unsupportedImageType', {}, 'Only PNG, JPEG, GIF, and WebP image files are supported for visual search.'));
      return;
    }

    setError('');
    setImageUrl('');

    const previewUrl = URL.createObjectURL(file);
    setUploadedPreview((previous) => {
      if (previous && previous.startsWith('blob:')) {
        URL.revokeObjectURL(previous);
      }
      return previewUrl;
    });

    const resolvedFileName = file.name || `${source}-capture-${Date.now()}.png`;
    setFileName(resolvedFileName);

    const [dimensions, nextImageDataUrl] = await Promise.all([
      readImageDimensions(file),
      readFileAsDataUrl(file),
    ]);
    setImageDataUrl(nextImageDataUrl);
    setImageMeta({
      source,
      mimeType: file.type || undefined,
      sizeBytes: Number(file.size) || undefined,
      width: dimensions.width,
      height: dimensions.height,
    });

    setHints((previous) => {
      if (String(previous || '').trim()) return previous;
      return resolvedFileName
        .replace(/\.[^.]+$/, '')
        .replace(/[_-]+/g, ' ')
        .trim()
        .slice(0, 180);
    });
  }, [t]);

  const runSearchWithPayload = async ({
    incomingUrl = imageUrl,
    incomingImageDataUrl = imageDataUrl,
    incomingFileName = fileName,
    incomingHints = hints,
    incomingImageMeta = imageMeta,
    incomingLimit = limit,
  } = {}) => {
    const cleanedUrl = String(incomingUrl || '').trim();
    const cleanedImageDataUrl = String(incomingImageDataUrl || '').trim();
    const cleanedHints = String(incomingHints || '').trim();
    const cleanedFileName = String(incomingFileName || '').trim() || deriveFileNameFromUrl(cleanedUrl);
    const safeLimit = toSafeLimit(incomingLimit, limit);
    const metadata = incomingImageMeta
      || (cleanedImageDataUrl ? { source: 'upload' } : (cleanedUrl ? { source: 'url' } : undefined));

    if (!cleanedUrl && !cleanedImageDataUrl && !cleanedHints && !cleanedFileName && !metadata) {
      setError(t('visualSearch.error.missingInput', {}, 'Provide image URL, uploaded screenshot, filename, or hint text.'));
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await productApi.visualSearch({
        imageUrl: cleanedUrl || undefined,
        imageDataUrl: cleanedImageDataUrl || undefined,
        fileName: cleanedFileName || undefined,
        hints: cleanedHints || undefined,
        imageMeta: metadata,
        limit: safeLimit,
      });

      setTokens(response?.querySignals?.tokens || []);
      setDerivedKeyword(response?.querySignals?.derivedKeyword || '');
      setMatches(response?.matches || []);
      setTotal(Number(response?.total || 0));
      setMarketSnapshot(response?.marketSnapshot || null);
    } catch (requestError) {
      setError(requestError.message || 'Visual search failed.');
      setMatches([]);
      setTotal(0);
      setTokens([]);
      setDerivedKeyword('');
      setMarketSnapshot(null);
    } finally {
      setLoading(false);
    }
  };

  const runSearch = async () => {
    await runSearchWithPayload();
  };

  const handleFilePick = async (event) => {
    const file = event.target.files?.[0];
    if (file) await applyImageFile(file, 'upload');
    event.target.value = '';
  };

  const handleCompareTop = () => {
    const ids = matches
      .map((product) => extractProductId(product))
      .filter(Boolean)
      .slice(0, 4);

    if (ids.length < 2) {
      setError(t('visualSearch.error.compareNeedsMatches', {}, 'Need at least 2 matched products to open AI Compare.'));
      return;
    }

    navigate(`/compare?ids=${ids.join(',')}`);
  };

  useEffect(() => {
    if (bootstrappedFromQueryRef.current) return;
    bootstrappedFromQueryRef.current = true;

    const presetImage = String(searchParams.get('imageUrl') || '').trim();
    const presetHints = String(searchParams.get('hints') || '').trim();
    const presetFileName = String(searchParams.get('fileName') || '').trim() || deriveFileNameFromUrl(presetImage);
    const presetLimit = toSafeLimit(searchParams.get('limit'), limit);

    if (presetImage) {
      setImageUrl(presetImage);
      clearUploadedPreview();
      setImageMeta({ source: 'url' });
    }
    if (presetFileName) setFileName(presetFileName);
    if (presetHints) setHints(presetHints);
    if (presetLimit !== limit) setLimit(presetLimit);

    if (presetImage || presetHints || presetFileName) {
      runSearchWithPayload({
        incomingUrl: presetImage,
        incomingFileName: presetFileName,
        incomingHints: presetHints,
        incomingImageMeta: presetImage ? { source: 'url' } : undefined,
        incomingLimit: presetLimit,
      });
    }
  }, [searchParams, limit, clearUploadedPreview]);

  useEffect(() => {
    const handlePaste = async (event) => {
      const items = Array.from(event.clipboardData?.items || []);
      const imageItem = items.find((item) => String(item.type || '').startsWith('image/'));
      if (!imageItem) return;
      const file = imageItem.getAsFile();
      if (!file) return;
      event.preventDefault();
      await applyImageFile(file, 'clipboard');
    };

    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('paste', handlePaste);
    };
  }, [applyImageFile]);

  useEffect(() => () => clearUploadedPreview(), [clearUploadedPreview]);

  return (
    <div className="visual-search-theme-shell container-custom max-w-7xl mx-auto px-4 py-8 min-h-screen">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-neo-cyan font-bold"><StableText id={"search.jsx.text.search.lab.da423c24"} defaultMessage={"Search Lab"} /></p>
          <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight"><StableText id={"search.jsx.text.visual.search.pro.bca7ad0b"} defaultMessage={"Visual Search Pro"} /></h1>
          <p className="text-slate-400 mt-2"><StableText id={"auth.jsx.text.upload.or.paste.a.screenshot.then.rank.9641b9df"} defaultMessage={"Upload or paste a screenshot, then rank closest products with price-gap and authenticity hints."} /></p>
        </div>
        <Link to="/compare" className="btn-secondary text-xs uppercase tracking-widest"><StableText id={"search.jsx.text.open.ai.compare.44e05796"} defaultMessage={"Open AI Compare"} /></Link>
      </div>

      <div className="grid lg:grid-cols-12 gap-6">
        <section className="lg:col-span-4 space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h2 className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2 mb-4">
              <Camera className="w-4 h-4 text-neo-cyan" />
              <StableText id={"search.jsx.text.search.input.bf54e1ea"} defaultMessage={"Search Input"} />
            </h2>

            <div className="space-y-3">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
                <StableText id={"search.jsx.text.upload.screenshot.5f2083fa"} defaultMessage={"Upload / Screenshot"} />
                <div className="mt-1.5 rounded-xl border border-dashed border-white/20 bg-zinc-950/70 p-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/gif,image/jpeg,image/png,image/webp"
                    onChange={handleFilePick}
                    className="hidden"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-bold text-white hover:border-neo-cyan/45 hover:text-neo-cyan transition-colors"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <StableText id={"search.jsx.text.choose.image.15fa1bac"} defaultMessage={"Choose Image"} />
                    </button>
                    {uploadedPreview && (
                      <button
                        type="button"
                        onClick={clearUploadedPreview}
                        className="inline-flex items-center gap-1 rounded-lg border border-neo-rose/35 bg-neo-rose/10 px-2.5 py-1.5 text-[11px] font-bold text-neo-rose"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <StableText id={"search.jsx.text.clear.upload.75485bae"} defaultMessage={"Clear Upload"} />
                      </button>
                    )}
                  </div>
                  <p className="mt-2 text-[11px] text-slate-400 inline-flex items-center gap-1.5">
                    <ClipboardPaste className="w-3.5 h-3.5 text-neo-cyan" />
                    <StableText id={"search.jsx.text.paste.screenshot.with.ctrl.v.anywhere.on.ce44511e"} defaultMessage={"Paste screenshot with Ctrl+V anywhere on this page."} />
                  </p>
                  {imageMeta && (
                    <p className="mt-1.5 text-[11px] text-slate-500">
                      {imageMeta.source || 'upload'}{imageMeta.mimeType ? ` · ${imageMeta.mimeType}` : ''}{imageMeta.sizeBytes ? ` · ${formatSize(imageMeta.sizeBytes)}` : ''}{imageMeta.width && imageMeta.height ? ` · ${imageMeta.width}x${imageMeta.height}` : ''}
                    </p>
                  )}
                </div>
              </label>

              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
                Image URL
                <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-white/15 bg-zinc-950/70 px-3 py-2">
                  <Link2 className="w-4 h-4 text-slate-500" />
                  <input
                    type="url"
                    value={imageUrl}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setImageUrl(nextValue);
                      if (String(nextValue || '').trim()) {
                        clearUploadedPreview();
                        setImageMeta({ source: 'url' });
                      } else if (!imageDataUrl) {
                        setImageMeta(null);
                      }
                    }}
                    placeholder="https://.../product-image.jpg"
                    className="w-full bg-transparent text-sm text-white placeholder:text-slate-500 outline-none"
                  />
                </div>
              </label>

              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
                <StableText id={"search.jsx.text.file.name.optional.ac353e76"} defaultMessage={"File Name (optional)"} />
                <input
                  type="text"
                  value={fileName}
                  onChange={(event) => setFileName(event.target.value)}
                  placeholder="iphone_15_blue.jpg"
                  className="mt-1.5 w-full rounded-xl border border-white/15 bg-zinc-950/70 px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-neo-cyan"
                />
              </label>

              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
                <StableText id={"search.jsx.text.hints.18758c62"} defaultMessage={"Hints"} />
                <textarea
                  value={hints}
                  onChange={(event) => setHints(event.target.value)}
                  placeholder="brand, color, category, model, use-case"
                  rows={4}
                  className="mt-1.5 w-full rounded-xl border border-white/15 bg-zinc-950/70 px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-neo-cyan resize-none"
                />
              </label>

              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
                <StableText id={"search.jsx.text.max.matches.1860e29d"} defaultMessage={"Max Matches"} />
                <input
                  type="range"
                  min={4}
                  max={24}
                  step={1}
                  value={limit}
                  onChange={(event) => setLimit(toSafeLimit(event.target.value, 12))}
                  className="mt-2 w-full accent-cyan-400"
                />
                <p className="text-[11px] text-slate-500 mt-1">{limit} matches</p>
              </label>
            </div>

            <button
              type="button"
              onClick={runSearch}
              disabled={loading}
              className="mt-4 w-full btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <span className="inline-flex items-center gap-2 justify-center">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                {loading ? <StableText id={"search.jsx.expression.scanning.catalog.f1f44d07"} defaultMessage={"Scanning Catalog..."} /> : <StableText id={"search.jsx.expression.run.visual.search.db1e93fa"} defaultMessage={"Run Visual Search"} />}
              </span>
            </button>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h3 className="text-xs font-black uppercase tracking-[0.18em] text-slate-300 mb-3"><StableText id={"search.jsx.text.quick.hints.30e95fa8"} defaultMessage={"Quick Hints"} /></h3>
            <div className="flex flex-wrap gap-2">
              {QUICK_HINTS.map((hint) => (
                <button
                  key={hint}
                  type="button"
                  onClick={() => setHints(hint)}
                  className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:border-neo-cyan/45 hover:text-neo-cyan transition-colors"
                >
                  {hint}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="lg:col-span-8 space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-neo-cyan" />
                  <StableText id={"search.jsx.text.match.intelligence.74bc104f"} defaultMessage={"Match Intelligence"} />
                </h2>
                <p className="text-xs text-slate-400 mt-1">{total} <StableText id={"product.jsx.text.matched.product.8b686b00"} defaultMessage={"matched product"} />{total === 1 ? '' : 's'} <StableText id={"search.jsx.text.from.live.catalog.8df55cd8"} defaultMessage={"from live catalog."} /></p>
              </div>
              <button
                type="button"
                onClick={handleCompareTop}
                disabled={matches.length < 2}
                className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="inline-flex items-center gap-2">
                  <Brain className="w-4 h-4" />
                  <StableText id={"search.jsx.text.compare.top.matches.4555d135"} defaultMessage={"Compare Top Matches"} />
                </span>
              </button>
            </div>

            {marketSnapshot && (
              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="rounded-lg border border-white/10 bg-zinc-950/60 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500"><StableText id={"search.jsx.text.median.1e89a3f6"} defaultMessage={"Median"} /></p>
                  <p className="text-sm font-black text-white">{formatBrowseAmount(marketSnapshot.medianMatchPrice || 0)}</p>
                </div>
                <div className="rounded-lg border border-white/10 bg-zinc-950/60 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500"><StableText id={"search.jsx.text.lowest.05ec1fbb"} defaultMessage={"Lowest"} /></p>
                  <p className="text-sm font-black text-neo-emerald">{formatBrowseAmount(marketSnapshot.minMatchPrice || 0)}</p>
                </div>
                <div className="rounded-lg border border-white/10 bg-zinc-950/60 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500"><StableText id={"search.jsx.text.highest.62013f0d"} defaultMessage={"Highest"} /></p>
                  <p className="text-sm font-black text-neo-rose">{formatBrowseAmount(marketSnapshot.maxMatchPrice || 0)}</p>
                </div>
                <div className="rounded-lg border border-white/10 bg-zinc-950/60 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500"><StableText id={"search.jsx.text.sample.9f86bc7f"} defaultMessage={"Sample"} /></p>
                  <p className="text-sm font-black text-white">{Number(marketSnapshot.sampleSize || 0)}</p>
                </div>
              </div>
            )}

            {(tokens.length > 0 || derivedKeyword) && (
              <div className="mt-4 rounded-xl border border-white/10 bg-zinc-950/60 p-3">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wider font-bold text-neo-cyan">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <StableText id={"search.jsx.text.scan.signals.abc546d3"} defaultMessage={"Scan Signals"} />
                </div>
                {derivedKeyword && (
                  <p className="text-xs text-slate-300 mt-2"><StableText id={"search.jsx.text.derived.keyword.eb081899"} defaultMessage={"Derived keyword:"} /> <span className="text-white font-semibold">{derivedKeyword}</span></p>
                )}
                {tokens.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {tokens.map((token) => (
                      <span key={token} className="rounded-full border border-neo-cyan/35 bg-neo-cyan/10 px-2 py-0.5 text-[11px] font-semibold text-neo-cyan">
                        {token}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {previewImage && (
              <div className="mt-4 rounded-xl border border-white/10 bg-zinc-950/60 p-3">
                <p className="text-[11px] uppercase tracking-wider font-bold text-slate-400 mb-2"><StableText id={"search.jsx.text.input.preview.deada035"} defaultMessage={"Input Preview"} /></p>
                <img
                  src={previewImage}
                  alt={t('visualSearch.inputPreview.alt', {}, 'Visual search input')}
                  className="h-40 w-full object-contain rounded-lg border border-white/10 bg-zinc-900"
                  loading="lazy"
                />
              </div>
            )}

            {error && (
              <div className="mt-4 rounded-xl border border-neo-rose/35 bg-neo-rose/10 px-4 py-3 text-sm text-neo-rose flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                {error}
              </div>
            )}
          </div>

          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {matches.map((product) => {
              const productId = extractProductId(product);
              const image = getPrimaryImage(product);
              const confidence = Number(product.visualConfidence || 0);
              const authenticity = product?.authenticityHints || {};
              const priceGap = product?.priceGap || {};

              return (
                <Link
                  key={`${productId}-${product.title}`}
                  to={productId ? `/product/${productId}` : '/products'}
                  className="rounded-2xl border border-white/10 bg-white/5 p-4 hover:border-neo-cyan/45 transition-colors"
                >
                  <div className="h-44 rounded-xl border border-white/10 bg-zinc-950/60 flex items-center justify-center overflow-hidden">
                    {image ? (
                      <img src={image} alt={product.title} className="w-full h-full object-contain" loading="lazy" />
                    ) : (
                      <div className="text-slate-500 text-sm"><StableText id={"search.jsx.text.no.image.dd0e0b47"} defaultMessage={"No image"} /></div>
                    )}
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2">
                    <p className="text-sm font-bold text-white line-clamp-2">{product.title || 'Untitled Product'}</p>
                    <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-black uppercase tracking-wider', confidenceTone(confidence))}>
                      {Math.round(confidence * 100)}%
                    </span>
                  </div>

                  <p className="mt-1 text-xs text-slate-400 line-clamp-1">{product.brand || 'Unknown brand'} · {product.category || 'General'}</p>

                  <div className="mt-2 flex items-center gap-2">
                    <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider', authenticityTone(authenticity?.verdict))}>
                      {authenticityLabel(authenticity?.verdict)} {Number(authenticity?.score || 0)}%
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400 line-clamp-2">{authenticity?.summary || 'Authenticity signals unavailable.'}</p>

                  <div className="mt-2">
                    <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold', priceGapTone(priceGap.position))}>
                      {summarizePriceGap(priceGap, formatBrowseAmount)}
                    </span>
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-base font-black text-white">{formatEntityPrice(formatPrice, product)}</span>
                    <span className="text-xs font-bold text-neo-cyan inline-flex items-center gap-1">
                      Open
                      <ArrowRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>

          {!loading && matches.length === 0 && !error && (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
              <p className="text-lg font-black text-white"><StableText id={"search.jsx.text.no.matches.yet.71b37d2b"} defaultMessage={"No matches yet"} /></p>
              <p className="text-sm text-slate-400 mt-2"><StableText id={"search.jsx.text.upload.paste.a.cleaner.image.or.add.6c3cc76a"} defaultMessage={"Upload/paste a cleaner image or add specific hints (brand + model + category)."} /></p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default VisualSearch;
