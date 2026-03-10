import { useState, useEffect, useContext, useCallback, useRef } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { BadgeCheck, Brain, Camera, Heart, ShoppingCart, Share2, Star, ChevronRight, Minus, Plus, Zap, MessageSquare, Send, Image as ImageIcon, Video, X, UploadCloud, Loader2 } from 'lucide-react';
import { CartContext } from '@/context/CartContext';
import { WishlistContext } from '@/context/WishlistContext';
import { AuthContext } from '@/context/AuthContext';
import { priceAlertApi, productApi, uploadApi } from '@/services/api';
import ProductCard from '@/components/features/product/ProductCard';
import ProductPageSkeleton from '@/components/shared/ProductPageSkeleton';
import SectionErrorBoundary from '@/components/shared/SectionErrorBoundary';
import { cn } from '@/lib/utils';
import { buildLifecycleIntelligence, buildProductTrustGraph } from '@/utils/commerceIntelligence';
import { pushRecentlyViewed } from '@/utils/recentlyViewed';

const DEFAULT_REVIEWS_SUMMARY = {
  averageRating: 0,
  totalReviews: 0,
  withMediaCount: 0,
  ratingBreakdown: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
};

const ProductDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  // Safe Context Access
  const cartContext = useContext(CartContext);
  const wishlistContext = useContext(WishlistContext);
  const authContext = useContext(AuthContext);

  const addToCart = cartContext?.addToCart || (() => console.warn('addToCart missing'));
  const cartItems = cartContext?.cartItems || [];
  const updateQuantity = cartContext?.updateQuantity || (() => console.warn('updateQuantity missing'));

  const toggleWishlist = wishlistContext?.toggleWishlist || (() => console.warn('toggleWishlist missing'));
  const isInWishlist = wishlistContext?.isInWishlist || (() => false);
  const currentUser = authContext?.currentUser || null;

  const [product, setProduct] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [relatedProducts, setRelatedProducts] = useState([]);
  const [activeTab, setActiveTab] = useState('description');
  const [quantity, setQuantity] = useState(1);
  const [compatibilityGraph, setCompatibilityGraph] = useState(null);
  const [compatibilityLoading, setCompatibilityLoading] = useState(false);
  const [compatibilityError, setCompatibilityError] = useState('');
  const [hasLoadedCompatibility, setHasLoadedCompatibility] = useState(false);
  const [reviewsData, setReviewsData] = useState([]);
  const [reviewsSummary, setReviewsSummary] = useState(DEFAULT_REVIEWS_SUMMARY);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsError, setReviewsError] = useState('');
  const [reviewSort, setReviewSort] = useState('newest');
  const [reviewForm, setReviewForm] = useState({
    rating: 5,
    comment: '',
    media: [],
  });
  const [mediaDraft, setMediaDraft] = useState({ type: 'image', url: '', caption: '' });
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewSubmitMessage, setReviewSubmitMessage] = useState('');
  const [reviewSubmitError, setReviewSubmitError] = useState('');
  const [reviewUploadInProgress, setReviewUploadInProgress] = useState(false);
  const [reviewUploadMessage, setReviewUploadMessage] = useState('');
  const [priceHistory, setPriceHistory] = useState([]);
  const [lifecycleNotice, setLifecycleNotice] = useState('');
  const [lifecycleError, setLifecycleError] = useState('');
  const filePickerRef = useRef(null);

  // Parse ID safely
  const productId = id ? parseInt(id, 10) : 0;

  // Derived state
  const isWishlisted = typeof isInWishlist === 'function' ? isInWishlist(productId) : false;
  const cartItem = Array.isArray(cartItems) ? cartItems.find(item => item.id === productId) : undefined;

  // Fetch Product Data
  useEffect(() => {
    let isMounted = true;

    const loadData = async () => {
      if (!id) return;

      setProduct(null);
      setIsLoading(true);
      setRelatedProducts([]);
      setCompatibilityGraph(null);
      setCompatibilityError('');
      setCompatibilityLoading(false);
      setHasLoadedCompatibility(false);
      setReviewsData([]);
      setReviewsSummary(DEFAULT_REVIEWS_SUMMARY);
      setReviewsError('');
      setReviewsLoading(false);
      setPriceHistory([]);
      setLifecycleNotice('');
      setLifecycleError('');
      try {
        console.log(`[ProductDetails] Fetching product ${id}...`);
        const data = await productApi.getProductById(id);

        if (isMounted) {
          if (data) {
            console.log('[ProductDetails] Product loaded:', data.title);
            setProduct(data);
          } else {
            console.error('[ProductDetails] API returned null data');
            setProduct(null);
          }
        }
      } catch (error) {
        console.error("[ProductDetails] CRITICAL LOAD ERROR:", error);
        if (isMounted) setProduct(null);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadData();

    return () => { isMounted = false; };
  }, [id]);

  useEffect(() => {
    const panel = new URLSearchParams(location.search).get('panel') || '';
    if (panel === 'deal-dna') {
      setActiveTab('deal-dna');
    } else if (panel === 'compatibility') {
      setActiveTab('compatibility');
    }
  }, [location.search]);

  // Fetch Related Products
  useEffect(() => {
    let isMounted = true;

    const loadRelated = async () => {
      if (!product || !product.category) return;

      try {
        const data = await productApi.getProducts({
          category: product.category,
          limit: 5,
          includeMeta: false,
          includeTelemetry: false,
          includeDealDna: 'false',
        });

        if (isMounted && data?.products) {
          const filtered = data.products
            .filter(p => p.id !== product.id)
            .slice(0, 4);
          setRelatedProducts(filtered);
        }
      } catch (err) {
        console.error("[ProductDetails] Related products error:", err);
      }
    };

    let timer = null;
    if (product) {
      timer = window.setTimeout(() => {
        loadRelated();
      }, 140);
    }

    return () => {
      isMounted = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [product]);

  useEffect(() => {
    let active = true;
    const loadCompatibility = async () => {
      if (activeTab !== 'compatibility' || hasLoadedCompatibility) return;
      if (!product?.id && !product?._id) return;
      setCompatibilityLoading(true);
      setCompatibilityError('');
      try {
        const productId = product.id || product._id;
        const response = await productApi.getCompatibility(productId, { limitPerType: 4 });
        if (!active) return;
        setCompatibilityGraph(response || null);
        setHasLoadedCompatibility(true);
      } catch (error) {
        if (!active) return;
        setCompatibilityError(error.message || 'Unable to build compatibility map');
      } finally {
        if (active) setCompatibilityLoading(false);
      }
    };

    loadCompatibility();
    return () => { active = false; };
  }, [activeTab, hasLoadedCompatibility, product?.id, product?._id]);

  const loadReviews = useCallback(async (sort = reviewSort) => {
    const productIdentifier = product?.id || product?._id;
    if (!productIdentifier) return;

    setReviewsLoading(true);
    setReviewsError('');
    try {
      const data = await productApi.getProductReviews(productIdentifier, {
        page: 1,
        limit: 8,
        sort,
      });
      setReviewsData(Array.isArray(data?.reviews) ? data.reviews : []);
      setReviewsSummary(data?.summary || DEFAULT_REVIEWS_SUMMARY);
      if (data?.summary) {
        setProduct((prev) => prev ? ({
          ...prev,
          rating: data.summary.averageRating ?? prev.rating,
          ratingCount: data.summary.totalReviews ?? prev.ratingCount,
        }) : prev);
      }
    } catch (error) {
      setReviewsError(error.message || 'Unable to load customer reviews');
    } finally {
      setReviewsLoading(false);
    }
  }, [product?.id, product?._id, reviewSort]);

  useEffect(() => {
    if (activeTab !== 'reviews') return;
    loadReviews(reviewSort);
  }, [activeTab, loadReviews, reviewSort]);

  useEffect(() => {
    if (!product) return;
    pushRecentlyViewed(product);
  }, [product]);

  useEffect(() => {
    let active = true;

    const loadPriceHistory = async () => {
      const productIdentifier = product?.id || product?._id;
      if (!productIdentifier) return;

      try {
        const data = await priceAlertApi.getHistory(productIdentifier);
        if (!active) return;
        setPriceHistory(Array.isArray(data?.history) ? data.history : []);
      } catch {
        if (!active) return;
        setPriceHistory([]);
      }
    };

    loadPriceHistory();
    return () => { active = false; };
  }, [product?.id, product?._id]);

  // Safe Formatters
  const formatPrice = (price) => {
    try {
      if (price === undefined || price === null) return '₹0';
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0,
      }).format(price);
    } catch (e) {
      return '₹0';
    }
  };

  // Handlers
  const handleAddToCart = () => {
    if (product) addToCart(product, quantity);
  };

  const handleBuyNow = () => {
    if (product) {
      // Direct Buy: Pass item via state, do NOT add to cart
      navigate('/checkout', {
        state: {
          directBuy: {
            product,
            quantity
          }
        }
      });
    }
  };

  const handleOpenCompare = () => {
    if (!product?.id && !product?._id) return;
    const id = product.id || product._id;
    navigate(`/compare?ids=${encodeURIComponent(String(id))}`);
  };

  const handleOpenVisualSearch = () => {
    if (!product) return;
    const params = new URLSearchParams();
    if (product.image) {
      params.set('imageUrl', String(product.image));
    }
    const hints = [product.brand, product.title, product.category].filter(Boolean).join(' ');
    if (hints) {
      params.set('hints', hints);
    }
    navigate(`/visual-search${params.toString() ? `?${params.toString()}` : ''}`);
  };

  const handleOpenBundleBuilder = () => {
    const theme = `${product?.category || product?.brand || 'smart essentials'}`.toLowerCase();
    const budget = Math.max(5000, Math.min(200000, Math.round((Number(product?.price) || 15000) * 2.5)));
    navigate(`/bundles?theme=${encodeURIComponent(theme)}&budget=${budget}`);
  };

  const handleOpenMissionControl = () => {
    const params = new URLSearchParams();
    params.set('goal', `${product?.brand || ''} ${product?.title || product?.category || 'upgrade'}`.trim());
    params.set('budget', String(Math.max(5000, Math.round((Number(product?.price) || 15000) * 2))));
    if (product?.category) {
      params.set('category', String(product.category));
    }
    navigate(`/mission-control?${params.toString()}`);
  };

  const handleSetPriceAlert = async () => {
    const productIdentifier = product?.id || product?._id;
    if (!productIdentifier) return;

    if (!currentUser) {
      navigate(`/login?redirect=${encodeURIComponent(`/product/${id}`)}`);
      return;
    }

    setLifecycleNotice('');
    setLifecycleError('');

    try {
      const suggestedTarget = Math.max(1, Math.round((Number(product?.price) || 0) * 0.92));
      const response = await priceAlertApi.create(productIdentifier, suggestedTarget);
      setLifecycleNotice(response?.message || `Price alert armed at ${formatPrice(suggestedTarget)}.`);
    } catch (error) {
      setLifecycleError(error.message || 'Unable to create price alert right now.');
    }
  };

  const handleOpenReviewFilePicker = () => {
    if (!currentUser) {
      navigate(`/login?redirect=${encodeURIComponent(`/product/${id}`)}`);
      return;
    }
    if (typeof filePickerRef?.current?.click === 'function') {
      filePickerRef.current.click();
    }
  };

  const handleReviewFileSelection = async (event) => {
    const incomingFiles = Array.from(event?.target?.files || []);
    if (incomingFiles.length === 0) return;

    if (!currentUser) {
      setReviewSubmitError('Login is required before media upload.');
      return;
    }

    const remainingSlots = Math.max(0, 8 - reviewForm.media.length);
    const filesToUpload = incomingFiles.slice(0, remainingSlots);
    if (filesToUpload.length === 0) {
      setReviewSubmitError('You already reached the maximum of 8 media files.');
      return;
    }

    setReviewUploadInProgress(true);
    setReviewUploadMessage(`Uploading ${filesToUpload.length} file(s)...`);
    setReviewSubmitError('');

    try {
      const uploadedMedia = [];
      for (const file of filesToUpload) {
        const mimeType = String(file?.type || '').toLowerCase();
        const isImage = mimeType.startsWith('image/');
        const isVideo = mimeType.startsWith('video/');
        if (!isImage && !isVideo) {
          throw new Error(`Unsupported file type: ${file.name}`);
        }
        if (file.size > 7 * 1024 * 1024) {
          throw new Error(`File too large (${file.name}). Max allowed is 7MB.`);
        }

        const response = await uploadApi.uploadReviewMediaFromFile(file);
        if (response?.media?.url) {
          uploadedMedia.push({
            type: response.media.type || (isVideo ? 'video' : 'image'),
            url: response.media.url,
            caption: '',
          });
        }
      }

      if (uploadedMedia.length > 0) {
        setReviewForm((prev) => ({
          ...prev,
          media: [...prev.media, ...uploadedMedia].slice(0, 8),
        }));
      }
      setReviewUploadMessage(`${uploadedMedia.length} media file(s) uploaded.`);
    } catch (error) {
      setReviewSubmitError(error?.message || 'Media upload failed.');
      setReviewUploadMessage('');
    } finally {
      setReviewUploadInProgress(false);
      if (event?.target) {
        event.target.value = '';
      }
    }
  };

  const handleAddReviewMedia = () => {
    const url = String(mediaDraft.url || '').trim();
    if (!url) return;

    if (!/^https?:\/\/[^\s]+$/i.test(url) && !/^\/uploads\/[^\s]+$/i.test(url)) {
      setReviewSubmitError('Media URL must be an http(s) link or /uploads path.');
      return;
    }

    setReviewSubmitError('');
    setReviewForm((prev) => {
      if (prev.media.length >= 8) return prev;
      const nextMedia = [
        ...prev.media,
        {
          type: mediaDraft.type === 'video' ? 'video' : 'image',
          url,
          caption: String(mediaDraft.caption || '').trim().slice(0, 160),
        },
      ];
      return { ...prev, media: nextMedia };
    });
    setMediaDraft((prev) => ({ ...prev, url: '', caption: '' }));
  };

  const handleRemoveReviewMedia = (index) => {
    setReviewForm((prev) => ({
      ...prev,
      media: prev.media.filter((_, mediaIndex) => mediaIndex !== index),
    }));
  };

  const handleSubmitReview = async (event) => {
    event.preventDefault();
    setReviewSubmitError('');
    setReviewSubmitMessage('');
    setReviewUploadMessage('');

    if (!currentUser) {
      navigate(`/login?redirect=${encodeURIComponent(`/product/${id}`)}`);
      return;
    }

    const trimmedComment = String(reviewForm.comment || '').trim();
    if (trimmedComment.length < 8) {
      setReviewSubmitError('Review comment must be at least 8 characters.');
      return;
    }

    const productIdentifier = product?.id || product?._id;
    if (!productIdentifier) {
      setReviewSubmitError('Invalid product for review submission.');
      return;
    }

    setReviewSubmitting(true);
    try {
      const response = await productApi.createProductReview(productIdentifier, {
        rating: Number(reviewForm.rating),
        comment: trimmedComment,
        media: reviewForm.media,
      });
      setReviewSubmitMessage(response?.message || 'Review submitted successfully.');
      setReviewForm({
        rating: 5,
        comment: '',
        media: [],
      });
      setMediaDraft({ type: 'image', url: '', caption: '' });
      await loadReviews(reviewSort);
    } catch (error) {
      setReviewSubmitError(error.message || 'Review submission failed.');
    } finally {
      setReviewSubmitting(false);
    }
  };

  const handleUpdateQty = (delta) => {
    const newQty = quantity + delta;
    if (newQty >= 1 && newQty <= (product?.stock || 1)) {
      setQuantity(newQty);
      if (cartItem) {
        updateQuantity(productId, newQty);
      }
    }
  };

  // --- RENDER GUARDS ---

  if (isLoading) {
    return <ProductPageSkeleton />;
  }

  if (!product) {
    return (
      <div className="container-custom max-w-7xl mx-auto py-20 px-4 text-center">
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-12 max-w-2xl mx-auto shadow-glass relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-neo-cyan/5 to-neo-rose/5 pointer-events-none" />
          <h2 className="text-3xl font-black mb-6 text-white tracking-widest uppercase">Product Not Found</h2>
          <p className="text-slate-400 mb-8">The item you are looking for could not be found.</p>
          <Link to="/" className="btn-primary inline-block px-10 py-3">Continue Shopping</Link>
        </div>
      </div>
    );
  }

  // Safe Data Access
  const {
    title = 'Unknown Item',
    displayTitle = '',
    subtitle = '',
    brand = 'Unknown Brand',
    rating = 0,
    ratingCount = 0,
    price = 0,
    originalPrice = 0,
    discountPercentage = 0,
    stock = 0,
    image = 'https://placehold.co/400x400/18181b/4ade80?text=Aura+Select',
    description = 'No description available.',
    highlights = [],
    deliveryTime = 'Instant Delivery',
    warranty = 'No warranty specified',
    category = 'General',
    subCategory = ''
  } = product;
  const heroTitle = displayTitle || title;
  const heroSubtitle = subtitle || subCategory || category;

  const dealDna = product?.dealDna || null;
  const isDemoCatalog = product?.publishGate?.status === 'dev_only' || product?.provenance?.sourceType === 'dev_seed';
  const dealTone = dealDna?.verdict === 'good_deal'
    ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100'
    : dealDna?.verdict === 'avoid'
      ? 'border-rose-400/40 bg-rose-500/15 text-rose-100'
      : 'border-amber-400/40 bg-amber-500/15 text-amber-100';
  const dealLabel = dealDna?.verdict === 'good_deal'
    ? 'Good Deal'
    : dealDna?.verdict === 'avoid'
      ? 'Avoid'
      : dealDna?.verdict === 'wait'
        ? 'Wait'
        : 'Review';
  const trustGraph = buildProductTrustGraph({ product, reviewsSummary, priceHistory });
  const lifecycleIntelligence = buildLifecycleIntelligence({ product, priceHistory });

  return (
    <div className="min-h-screen pb-16 pt-4 relative">
      {/* Background Decor */}
      <div className="absolute top-0 right-0 w-[min(70vw,500px)] h-[min(70vw,500px)] bg-neo-cyan/10 rounded-full blur-[150px] pointer-events-none -z-10" />
      <div className="absolute bottom-40 left-0 w-[min(70vw,500px)] h-[min(70vw,500px)] bg-neo-emerald/10 rounded-full blur-[150px] pointer-events-none -z-10" />

      <div className="container-custom max-w-7xl mx-auto px-4 md:px-6 py-6 border-t border-white/5">
        {/* Breadcrumb */}
        <nav className="text-[10px] md:text-sm text-slate-500 font-bold uppercase tracking-widest mb-8 flex items-center flex-wrap gap-y-2">
          <Link to="/" className="hover:text-neo-cyan transition-colors">Aura</Link>
          <ChevronRight className="w-4 h-4 mx-2 text-slate-700" />
          <Link to={`/category/${(category || 'all').toLowerCase().replace(/\s+/g, '-')}`} className="hover:text-neo-cyan transition-colors">
            {category}
          </Link>
          <ChevronRight className="w-4 h-4 mx-2 text-slate-700" />
          <span className="text-white truncate max-w-[200px] md:max-w-md">{heroTitle}</span>
        </nav>

        <div className="grid lg:grid-cols-12 gap-8 lg:gap-12">
          {/* Left Column: Image & Buttons */}
          <div className="lg:col-span-5 flex flex-col gap-6">
            <div className="bg-white/[0.045] backdrop-blur-xl rounded-3xl border border-white/10 shadow-glass p-6 sticky top-24 group relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-tr from-neo-cyan/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />

              <div className="relative aspect-square flex items-center justify-center p-4">
                <img
                  src={image}
                  alt={heroTitle}
                  className="w-full h-full object-contain drop-shadow-[0_0_20px_rgba(255,255,255,0.15)] mix-blend-screen hover:scale-105 transition-transform duration-700 relative z-10"
                />

                <button
                  onClick={() => toggleWishlist(product)}
                  className="absolute top-0 right-0 p-3 bg-zinc-950/50 backdrop-blur-md rounded-full border border-white/10 shadow-[0_0_15px_rgba(0,0,0,0.5)] hover:border-neo-rose hover:bg-neo-rose/10 transition-all duration-300 z-20 group/btn"
                >
                  <Heart className={cn('w-6 h-6 transition-colors', isWishlisted ? 'fill-neo-rose text-neo-rose drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]' : 'text-slate-400 group-hover/btn:text-neo-rose')} />
                </button>

                <button
                  onClick={() => navigator?.share?.({ title: heroTitle, url: window.location.href })}
                  className="absolute top-0 left-0 p-3 bg-zinc-950/50 backdrop-blur-md rounded-full border border-white/10 shadow-[0_0_15px_rgba(0,0,0,0.5)] hover:border-neo-cyan hover:bg-neo-cyan/10 transition-all duration-300 z-20 group/btn"
                >
                  <Share2 className="w-5 h-5 text-slate-400 group-hover/btn:text-neo-cyan transition-colors" />
                </button>
              </div>
            </div>

            {/* Mobile Actions - Sticky Bottom */}
            <div className="fixed bottom-0 left-0 right-0 p-4 bg-zinc-950/90 backdrop-blur-xl border-t border-white/10 z-50 lg:hidden flex gap-4">
              <button
                onClick={handleAddToCart}
                disabled={stock === 0}
                className="flex-1 btn-secondary py-4 text-sm tracking-widest flex justify-center items-center gap-2 relative overflow-hidden group border-white/20 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]"
              >
                <ShoppingCart className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
                <span className="relative z-10">Add to Bag</span>
              </button>
              <button
                onClick={handleBuyNow}
                disabled={stock === 0}
                className="flex-1 btn-primary py-4 text-sm tracking-widest relative overflow-hidden group shadow-[0_0_15px_rgba(217,70,239,0.3)]"
              >
                <span className="relative z-10 flex items-center justify-center gap-2">
                  <Zap className="w-4 h-4 fill-white animate-pulse" /> Buy Now
                </span>
                <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
              </button>
            </div>
          </div>

          {/* Right Column: Details */}
          <div className="lg:col-span-7">
            <div className="bg-white/[0.045] backdrop-blur-xl rounded-3xl border border-white/10 shadow-glass p-6 md:p-10 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-neo-emerald/5 to-transparent pointer-events-none" />

              <div className="relative z-10">
                <p className="text-neo-cyan font-bold tracking-[0.3em] uppercase text-xs mb-3">{brand}</p>
                {heroSubtitle && (
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                    {heroSubtitle}
                  </p>
                )}
                <h1 className="text-3xl md:text-5xl font-black text-white mb-6 leading-tight tracking-tighter">
                  {heroTitle}
                </h1>
                {isDemoCatalog && (
                  <div className="mb-6 rounded-2xl border border-sky-400/30 bg-sky-500/10 px-4 py-3">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-sky-200">Demo Catalog</p>
                    <p className="mt-2 text-sm leading-relaxed text-sky-50/90">
                      This item is being served from the demo catalog fallback because the active catalog currently has no published inventory.
                    </p>
                  </div>
                )}

                <div className="flex items-center gap-4 mb-8">
                  <span className="rating-badge text-sm px-3 py-1 shadow-[0_0_10px_rgba(250,204,21,0.3)]">
                    {rating}<Star className="w-3 h-3 fill-zinc-950 ml-1" />
                  </span>
                  <span className="text-slate-400 font-medium text-sm tracking-wide bg-white/5 px-3 py-1 rounded-full border border-white/5">
                    {ratingCount.toLocaleString()} Reviews
                  </span>
                  {dealDna && (
                    <span className={cn('text-[10px] px-3 py-1 rounded-full border font-black uppercase tracking-widest inline-flex items-center gap-1.5', dealTone)}>
                      <BadgeCheck className="w-3 h-3" />
                      Deal DNA {dealDna.score} • {dealLabel}
                    </span>
                  )}
                </div>

                <div className="flex items-end gap-4 mb-6 flex-wrap bg-zinc-950/50 p-6 rounded-2xl border border-white/5 shadow-inner">
                  <span className="text-5xl font-black text-white tracking-tighter drop-shadow-[0_0_15px_rgba(255,255,255,0.2)]">
                    {formatPrice(price)}
                  </span>
                  <div className="flex flex-col pb-1">
                    <span className="text-slate-500 line-through text-lg font-medium tracking-wide">
                      {formatPrice(originalPrice)}
                    </span>
                    <span className="text-neo-cyan font-black uppercase tracking-wider text-sm flex items-center gap-1">
                      <Zap className="w-3 h-3 fill-neo-cyan" /> {discountPercentage}% Off
                    </span>
                  </div>
                </div>

                <div className="mb-8 flex items-center gap-3">
                  <div className={cn('w-3 h-3 rounded-full animate-pulse', stock > 0 ? 'bg-neo-cyan shadow-[0_0_10px_rgba(6,182,212,0.8)]' : 'bg-neo-rose shadow-[0_0_10px_rgba(244,63,94,0.8)]')} />
                  <p className={cn('text-sm font-bold uppercase tracking-widest', stock > 0 ? 'text-neo-cyan' : 'text-neo-rose')}>
                    {stock > 0 ? `In Stock (${stock} Available)` : 'Out of Stock'}
                  </p>
                </div>

                {/* Desktop Actions */}
                <div className="hidden lg:flex gap-6 mb-12">
                  {cartItem ? (
                    <div className="flex items-center gap-6 border-2 border-neo-cyan/50 bg-neo-cyan/5 rounded-2xl px-6 py-3 shadow-[0_0_15px_rgba(6,182,212,0.1)]">
                      <button onClick={() => handleUpdateQty(-1)} disabled={cartItem.quantity <= 1} className="text-neo-cyan hover:text-white disabled:opacity-50 transition-colors">
                        <Minus className="w-6 h-6" />
                      </button>
                      <span className="font-black text-2xl text-white w-8 text-center">{cartItem.quantity}</span>
                      <button onClick={() => handleUpdateQty(1)} disabled={cartItem.quantity >= stock} className="text-neo-cyan hover:text-white disabled:opacity-50 transition-colors">
                        <Plus className="w-6 h-6" />
                      </button>
                    </div>
                  ) : (
                    <button onClick={handleAddToCart} disabled={stock === 0} className="btn-secondary px-10 py-4 flex items-center gap-3 text-sm tracking-widest border-white/20 group/add">
                      <ShoppingCart className="w-5 h-5 group-hover/add:-translate-x-1 transition-transform" />
                      <span className="relative z-10">Add to Bag</span>
                    </button>
                  )}
                  <button onClick={handleBuyNow} disabled={stock === 0} className="btn-primary px-10 py-4 text-sm tracking-widest flex items-center gap-2 group/buy shadow-[0_0_20px_rgba(16,185,129,0.3)]">
                    <Zap className="w-4 h-4 fill-white group-hover/buy:animate-pulse" />
                    <span className="relative z-10">Buy Now</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-12">
                  <button
                    onClick={handleOpenCompare}
                    className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-black uppercase tracking-widest text-slate-100 hover:border-neo-cyan/45 hover:text-neo-cyan transition-colors inline-flex items-center justify-center gap-2"
                  >
                    <Brain className="w-4 h-4" />
                    AI Compare
                  </button>
                  <button
                    onClick={handleOpenVisualSearch}
                    className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-black uppercase tracking-widest text-slate-100 hover:border-neo-emerald/45 hover:text-neo-emerald transition-colors inline-flex items-center justify-center gap-2"
                  >
                    <Camera className="w-4 h-4" />
                    Visual Match
                  </button>
                  <button
                    onClick={handleOpenBundleBuilder}
                    className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-black uppercase tracking-widest text-slate-100 hover:border-violet-400/45 hover:text-violet-300 transition-colors inline-flex items-center justify-center gap-2"
                  >
                    <Zap className="w-4 h-4" />
                    Smart Bundle
                  </button>
                  <button
                    onClick={() => setActiveTab('compatibility')}
                    className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-black uppercase tracking-widest text-slate-100 hover:border-emerald-400/45 hover:text-emerald-300 transition-colors inline-flex items-center justify-center gap-2"
                  >
                    <BadgeCheck className="w-4 h-4" />
                    Compatibility
                  </button>
                </div>

                <div className="grid gap-4 mb-12 lg:grid-cols-2">
                  <section className="rounded-2xl border border-white/10 bg-zinc-950/45 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.16em] text-neo-cyan">Trust Graph</p>
                        <h2 className="mt-2 text-xl font-black text-white">{trustGraph.headline}</h2>
                      </div>
                      <div className={cn(
                        'rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.14em]',
                        trustGraph.tone === 'emerald'
                          ? 'border-emerald-400/35 bg-emerald-500/10 text-emerald-100'
                          : trustGraph.tone === 'amber'
                            ? 'border-amber-400/35 bg-amber-500/10 text-amber-100'
                            : trustGraph.tone === 'rose'
                              ? 'border-rose-400/35 bg-rose-500/10 text-rose-100'
                              : 'border-neo-cyan/35 bg-neo-cyan/10 text-neo-cyan'
                      )}>
                        Trust {trustGraph.overallScore}
                      </div>
                    </div>
                    <p className="mt-3 text-sm text-slate-400">{trustGraph.summary}</p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {trustGraph.metrics.slice(0, 4).map((metric) => (
                        <div key={metric.key} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">{metric.label}</span>
                            <span className="text-sm font-black text-white">{metric.score}</span>
                          </div>
                          <p className="mt-1 text-xs text-slate-400">{metric.insight}</p>
                        </div>
                      ))}
                    </div>
                    {trustGraph.watchouts.length > 0 && (
                      <div className="mt-4 rounded-xl border border-amber-400/25 bg-amber-500/10 p-3">
                        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-amber-200">Watchouts</p>
                        <ul className="mt-2 space-y-1 text-sm text-amber-100/90">
                          {trustGraph.watchouts.map((item) => (
                            <li key={item}>- {item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </section>

                  <section className="rounded-2xl border border-white/10 bg-zinc-950/45 p-5">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-200">Resale + Upgrade Intelligence</p>
                    <h2 className="mt-2 text-xl font-black text-white">{lifecycleIntelligence.upgradeWindow}</h2>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
                        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">Trade-in estimate</p>
                        <p className="mt-2 text-2xl font-black text-white">{formatPrice(lifecycleIntelligence.tradeInEstimate)}</p>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
                        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">Expected 90-day slide</p>
                        <p className="mt-2 text-2xl font-black text-white">{formatPrice(lifecycleIntelligence.ninetyDayDepreciation)}</p>
                      </div>
                    </div>
                    <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-3">
                      <p className="text-sm text-slate-200">{lifecycleIntelligence.nextBestAction.reason}</p>
                      <p className="mt-2 text-xs text-slate-400">
                        Resale band {formatPrice(lifecycleIntelligence.resaleLow)} - {formatPrice(lifecycleIntelligence.resaleHigh)}
                      </p>
                    </div>
                    {(lifecycleNotice || lifecycleError) && (
                      <div className={cn(
                        'mt-4 rounded-xl border px-3 py-2 text-sm',
                        lifecycleError
                          ? 'border-rose-400/30 bg-rose-500/10 text-rose-100'
                          : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'
                      )}>
                        {lifecycleError || lifecycleNotice}
                      </div>
                    )}
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={handleSetPriceAlert}
                        className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-bold text-slate-100 hover:border-neo-cyan/45 hover:text-neo-cyan transition-colors"
                      >
                        Set price alert
                      </button>
                      <Link
                        to="/trade-in"
                        className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-bold text-slate-100 hover:border-emerald-400/45 hover:text-emerald-300 transition-colors"
                      >
                        Trade-in path
                      </Link>
                      <button
                        type="button"
                        onClick={handleOpenMissionControl}
                        className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-bold text-slate-100 hover:border-violet-400/45 hover:text-violet-300 transition-colors"
                      >
                        Open Mission OS
                      </button>
                    </div>
                  </section>
                </div>

                {/* Tabs */}
                <div className="border-t border-white/10 pt-8">
                  <div className="flex gap-8 border-b border-white/5 mb-8 overflow-x-auto scrollbar-hide">
                    {['description', 'specifications', 'deal-dna', 'compatibility', 'reviews'].map(tab => (
                      <button key={tab} onClick={() => setActiveTab(tab)}
                        className={cn('pb-4 text-xs md:text-sm font-bold tracking-widest uppercase transition-colors relative whitespace-nowrap',
                          activeTab === tab ? 'text-neo-cyan' : 'text-slate-500 hover:text-slate-300')}>
                        {tab === 'deal-dna' ? 'Deal DNA' : tab}
                        {activeTab === tab && (
                          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-neo-cyan to-neo-emerald shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
                        )}
                      </button>
                    ))}
                  </div>

                  <div className="min-h-[200px] animate-fade-in text-slate-300">
                    {activeTab === 'description' && (
                      <div className="space-y-8">
                        <p className="leading-relaxed text-lg font-medium">{description}</p>
                        {highlights.length > 0 && (
                          <div className="bg-zinc-950/50 p-6 rounded-2xl border border-white/5">
                            <h3 className="font-bold text-white mb-4 uppercase tracking-widest text-sm text-neo-emerald">Core Specs:</h3>
                            <ul className="space-y-3">
                              {highlights.map((h, i) => (
                                <li key={i} className="flex items-start gap-3">
                                  <div className="w-1.5 h-1.5 rounded-full bg-neo-cyan mt-2 shadow-[0_0_5px_rgba(6,182,212,0.8)]" />
                                  <span className="leading-relaxed">{h}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

                    {activeTab === 'specifications' && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-zinc-950/50 p-5 rounded-xl border border-white/5 flex flex-col gap-1">
                          <span className="text-slate-500 text-xs uppercase tracking-widest font-bold">Manufacturer</span>
                          <p className="text-white font-medium text-lg">{brand}</p>
                        </div>
                        <div className="bg-zinc-950/50 p-5 rounded-xl border border-white/5 flex flex-col gap-1">
                          <span className="text-slate-500 text-xs uppercase tracking-widest font-bold">Warranty</span>
                          <p className="text-white font-medium text-lg">{warranty}</p>
                        </div>
                        <div className="bg-zinc-950/50 p-5 rounded-xl border border-white/5 flex flex-col gap-1 md:col-span-2">
                          <span className="text-slate-500 text-xs uppercase tracking-widest font-bold">Delivery Time</span>
                          <p className="text-white font-medium text-lg">{deliveryTime}</p>
                        </div>
                      </div>
                    )}

                    {activeTab === 'deal-dna' && (
                      <div className="space-y-4">
                        {!dealDna ? (
                          <p className="text-sm text-slate-400">Deal DNA is not available for this product yet.</p>
                        ) : (
                          <>
                            <div className={cn('rounded-2xl border p-5', dealTone)}>
                              <p className="text-xs font-black uppercase tracking-[0.16em]">Fortress Verdict</p>
                              <p className="mt-2 text-2xl font-black">{dealLabel} • Score {dealDna.score}/100</p>
                              <p className="mt-2 text-sm text-slate-100/90">{dealDna.message}</p>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                              {Object.entries(dealDna.components || {}).map(([key, value]) => (
                                <div key={key} className="rounded-xl border border-white/10 bg-zinc-950/50 px-3 py-2">
                                  <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">{key}</p>
                                  <p className="text-lg font-black text-white">{value}</p>
                                </div>
                              ))}
                            </div>
                            {(dealDna.returnRisk?.reasons || []).length > 0 && (
                              <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-4">
                                <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-200 mb-2">Return Risk Drivers</p>
                                <ul className="space-y-1 text-sm text-amber-100/90">
                                  {(dealDna.returnRisk.reasons || []).map((reason) => (
                                    <li key={reason}>- {reason}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}

                    {activeTab === 'compatibility' && (
                      <div className="space-y-4">
                        {compatibilityLoading && (
                          <p className="text-sm text-slate-400">Building compatibility graph...</p>
                        )}
                        {!compatibilityLoading && compatibilityError && (
                          <p className="text-sm text-rose-300">{compatibilityError}</p>
                        )}
                        {!compatibilityLoading && !compatibilityError && (!compatibilityGraph?.groups || compatibilityGraph.groups.length === 0) && (
                          <p className="text-sm text-slate-400">No compatibility data available for this category yet.</p>
                        )}
                        {!compatibilityLoading && !compatibilityError && Array.isArray(compatibilityGraph?.groups) && compatibilityGraph.groups.length > 0 && (
                          <div className="space-y-4">
                            {compatibilityGraph.groups.map((group) => (
                              <div key={group.accessoryType} className="rounded-2xl border border-white/10 bg-zinc-950/40 p-4">
                                <p className="text-xs font-black uppercase tracking-[0.16em] text-neo-cyan mb-3">
                                  {group.accessoryType}
                                </p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  {(group.matches || []).map((item) => (
                                    <Link
                                      key={`${group.accessoryType}-${item.id}`}
                                      to={`/product/${item.id}`}
                                      className="rounded-xl border border-white/10 bg-white/5 p-3 hover:border-neo-emerald/45 transition-colors"
                                    >
                                      <div className="flex items-center gap-3">
                                        <img src={item.image} alt={item.title} className="w-14 h-14 rounded-lg object-cover bg-zinc-900/70" />
                                        <div className="min-w-0">
                                          <p className="text-sm font-bold text-white truncate">{item.title}</p>
                                          <p className="text-xs text-slate-400 truncate">{item.brand} • {item.category}</p>
                                          <p className="text-xs text-neo-cyan font-bold mt-1">
                                            Compatibility {item.compatibilityScore}/100
                                          </p>
                                        </div>
                                      </div>
                                    </Link>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {activeTab === 'reviews' && (
                      <div className="space-y-6">
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                          <div className="lg:col-span-1 rounded-2xl border border-white/10 bg-zinc-950/45 p-5">
                            <p className="text-xs uppercase tracking-[0.16em] text-slate-400 font-bold">Community Score</p>
                            <p className="mt-2 text-4xl font-black text-white">{Number(reviewsSummary.averageRating || 0).toFixed(1)}</p>
                            <p className="mt-1 text-sm text-slate-400">
                              {Number(reviewsSummary.totalReviews || 0).toLocaleString()} verified reviews
                            </p>
                            <p className="mt-1 text-xs text-neo-cyan font-semibold">
                              {Number(reviewsSummary.withMediaCount || 0).toLocaleString()} with photo/video proof
                            </p>
                            <div className="mt-4 space-y-2">
                              {[5, 4, 3, 2, 1].map((score) => {
                                const count = Number(reviewsSummary.ratingBreakdown?.[score] || 0);
                                const percent = reviewsSummary.totalReviews > 0
                                  ? Math.round((count / reviewsSummary.totalReviews) * 100)
                                  : 0;
                                return (
                                  <div key={score} className="flex items-center gap-3 text-xs text-slate-300">
                                    <span className="w-4 font-bold">{score}</span>
                                    <div className="h-2 flex-1 rounded-full bg-white/10 overflow-hidden">
                                      <div
                                        className="h-2 bg-gradient-to-r from-neo-cyan to-neo-emerald"
                                        style={{ width: `${percent}%` }}
                                      />
                                    </div>
                                    <span className="w-8 text-right">{count}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          <div className="lg:col-span-2 rounded-2xl border border-white/10 bg-zinc-950/45 p-5">
                            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                              <p className="text-xs uppercase tracking-[0.16em] text-slate-400 font-bold">Verified Customer Feedback</p>
                              <select
                                value={reviewSort}
                                onChange={(e) => setReviewSort(e.target.value)}
                                className="rounded-lg border border-white/15 bg-zinc-950/70 px-3 py-2 text-xs font-bold uppercase tracking-[0.1em] text-slate-200"
                              >
                                <option value="newest">Newest</option>
                                <option value="top-rating">Top Rated</option>
                                <option value="oldest">Oldest</option>
                                <option value="helpful">Most Helpful</option>
                              </select>
                            </div>

                            {reviewsLoading ? (
                              <div className="space-y-3">
                                {[...Array(3)].map((_, idx) => (
                                  <div key={idx} className="h-24 rounded-xl bg-white/5 animate-pulse border border-white/5" />
                                ))}
                              </div>
                            ) : reviewsError ? (
                              <p className="text-sm text-rose-300">{reviewsError}</p>
                            ) : reviewsData.length === 0 ? (
                              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-center">
                                <MessageSquare className="w-8 h-8 mx-auto text-slate-500 mb-2" />
                                <p className="text-sm text-slate-300">No verified reviews yet for this product.</p>
                              </div>
                            ) : (
                              <div className="space-y-4 max-h-[480px] overflow-y-auto pr-1">
                                {reviewsData.map((review) => (
                                  <article key={review.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                      <div>
                                        <p className="text-sm font-bold text-white">{review.user?.name || 'Verified Buyer'}</p>
                                        <p className="text-[11px] text-slate-400">
                                          {new Date(review.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                                        </p>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <span className="rating-badge text-xs px-2 py-1">
                                          {review.rating}
                                          <Star className="w-3 h-3 fill-zinc-950 ml-1" />
                                        </span>
                                        {review.isVerifiedPurchase && (
                                          <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-300">
                                            <BadgeCheck className="w-3 h-3" />
                                            Verified Purchase
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    <p className="mt-3 text-sm leading-relaxed text-slate-200">{review.comment}</p>
                                    {Array.isArray(review.media) && review.media.length > 0 && (
                                      <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2">
                                        {review.media.map((asset, index) => (
                                          <div key={`${review.id}-media-${index}`} className="rounded-lg overflow-hidden border border-white/10 bg-zinc-900/70">
                                            {asset.type === 'video' ? (
                                              <video src={asset.url} controls className="w-full h-24 object-cover" />
                                            ) : (
                                              <img src={asset.url} alt={asset.caption || 'Review media'} className="w-full h-24 object-cover" />
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </article>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-white/10 bg-zinc-950/45 p-5">
                          <p className="text-xs uppercase tracking-[0.16em] text-slate-400 font-bold mb-4">Post Your Verified Review</p>
                          {!currentUser && (
                            <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-100 mb-4">
                              Login is required to post a review. Only real customers with a valid purchase can submit feedback.
                            </div>
                          )}
                          {reviewSubmitMessage && (
                            <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3 text-sm text-emerald-100 mb-4">
                              {reviewSubmitMessage}
                            </div>
                          )}
                          {reviewSubmitError && (
                            <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100 mb-4">
                              {reviewSubmitError}
                            </div>
                          )}

                          <form onSubmit={handleSubmitReview} className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              <div>
                                <label className="text-xs uppercase tracking-[0.12em] text-slate-400 font-bold">Rating</label>
                                <select
                                  value={reviewForm.rating}
                                  onChange={(e) => setReviewForm((prev) => ({ ...prev, rating: Number(e.target.value) }))}
                                  className="mt-1 w-full rounded-lg border border-white/15 bg-zinc-950/70 px-3 py-2 text-sm text-white"
                                >
                                  <option value={5}>5 - Excellent</option>
                                  <option value={4}>4 - Good</option>
                                  <option value={3}>3 - Average</option>
                                  <option value={2}>2 - Poor</option>
                                  <option value={1}>1 - Bad</option>
                                </select>
                              </div>
                              <div className="md:col-span-2">
                                <label className="text-xs uppercase tracking-[0.12em] text-slate-400 font-bold">Comment</label>
                                <textarea
                                  value={reviewForm.comment}
                                  onChange={(e) => setReviewForm((prev) => ({ ...prev, comment: e.target.value }))}
                                  placeholder="Share real usage experience, quality, delivery, and value details..."
                                  rows={3}
                                  className="mt-1 w-full rounded-lg border border-white/15 bg-zinc-950/70 px-3 py-2 text-sm text-white resize-none"
                                />
                              </div>
                            </div>

                            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                <p className="text-xs uppercase tracking-[0.12em] text-slate-400 font-bold">
                                  Add Proof Media (Direct Upload + URL)
                                </p>
                                <button
                                  type="button"
                                  onClick={handleOpenReviewFilePicker}
                                  disabled={reviewUploadInProgress}
                                  className="rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-bold text-emerald-200 hover:bg-emerald-500/25 inline-flex items-center gap-1.5 disabled:opacity-70"
                                >
                                  {reviewUploadInProgress ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
                                  {reviewUploadInProgress ? 'Uploading...' : 'Upload From Device'}
                                </button>
                                <input
                                  ref={filePickerRef}
                                  type="file"
                                  accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
                                  multiple
                                  className="hidden"
                                  onChange={handleReviewFileSelection}
                                />
                              </div>
                              {reviewUploadMessage && (
                                <p className="mb-2 text-xs font-semibold text-emerald-200">{reviewUploadMessage}</p>
                              )}
                              <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                                <select
                                  value={mediaDraft.type}
                                  onChange={(e) => setMediaDraft((prev) => ({ ...prev, type: e.target.value }))}
                                  className="rounded-lg border border-white/15 bg-zinc-950/70 px-3 py-2 text-sm text-white"
                                >
                                  <option value="image">Image</option>
                                  <option value="video">Video</option>
                                </select>
                                <input
                                  type="text"
                                  value={mediaDraft.url}
                                  onChange={(e) => setMediaDraft((prev) => ({ ...prev, url: e.target.value }))}
                                  placeholder="https://..."
                                  className="md:col-span-2 rounded-lg border border-white/15 bg-zinc-950/70 px-3 py-2 text-sm text-white"
                                />
                                <button
                                  type="button"
                                  onClick={handleAddReviewMedia}
                                  className="rounded-lg border border-neo-cyan/40 bg-neo-cyan/15 px-3 py-2 text-sm font-bold text-neo-cyan hover:bg-neo-cyan/25"
                                >
                                  Add Media
                                </button>
                              </div>
                              <input
                                type="text"
                                value={mediaDraft.caption}
                                onChange={(e) => setMediaDraft((prev) => ({ ...prev, caption: e.target.value }))}
                                placeholder="Optional caption"
                                className="mt-2 w-full rounded-lg border border-white/15 bg-zinc-950/70 px-3 py-2 text-sm text-white"
                              />
                              {reviewForm.media.length > 0 && (
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {reviewForm.media.map((asset, index) => (
                                    <div key={`${asset.url}-${index}`} className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs text-slate-200">
                                      {asset.type === 'video' ? <Video className="w-3.5 h-3.5 text-violet-300" /> : <ImageIcon className="w-3.5 h-3.5 text-neo-cyan" />}
                                      <span className="max-w-[180px] truncate">{asset.url}</span>
                                      <button type="button" onClick={() => handleRemoveReviewMedia(index)} className="text-slate-400 hover:text-rose-300">
                                        <X className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            <button
                              type="submit"
                              disabled={reviewSubmitting || reviewUploadInProgress}
                              className="btn-primary px-6 py-3 inline-flex items-center gap-2 disabled:opacity-70"
                            >
                              <Send className="w-4 h-4" />
                              {reviewSubmitting ? 'Submitting...' : 'Submit Verified Review'}
                            </button>
                          </form>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {relatedProducts.length > 0 && (
          <SectionErrorBoundary label="Similar Items">
            <div className="mt-20">
              <div className="flex items-center gap-4 mb-8">
                <h2 className="text-2xl font-black text-white tracking-tight">Similar Items</h2>
                <div className="flex-1 h-px bg-gradient-to-r from-white/10 to-transparent" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
                {relatedProducts.map(p => <ProductCard key={p.id} product={p} />)}
              </div>
            </div>
          </SectionErrorBoundary>
        )}
      </div>
    </div>
  );
};

export default ProductDetails;

