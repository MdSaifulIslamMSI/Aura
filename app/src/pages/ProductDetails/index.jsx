import { useState, useEffect, useContext, useCallback, useDeferredValue, useMemo, useRef } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { BadgeCheck, Brain, Camera, Heart, ShoppingCart, Share2, Star, ChevronRight, Minus, Plus, Zap, MessageSquare, Send, Image as ImageIcon, Video, X, UploadCloud, Loader2, PackageCheck, ShieldCheck, Truck } from 'lucide-react';
import { CartContext } from '@/context/CartContext';
import { WishlistContext } from '@/context/WishlistContext';
import { AuthContext } from '@/context/AuthContext';
import { useMarket } from '@/context/MarketContext';
import { useCommerceStore } from '@/store/commerceStore';
import { priceAlertApi, productApi, uploadApi } from '@/services/api';
import { pushClientDiagnostic } from '@/services/clientObservability';
import ProductCard from '@/components/features/product/ProductCard';
import ProductPageSkeleton from '@/components/shared/ProductPageSkeleton';
import SectionErrorBoundary from '@/components/shared/SectionErrorBoundary';
import PremiumSelect from '@/components/ui/premium-select';
import { useDynamicTranslations } from '@/hooks/useDynamicTranslations';
import { cn } from '@/lib/utils';
import { buildProductTrustGraph } from '@/utils/commerceIntelligence';
import { pushRecentlyViewed } from '@/utils/recentlyViewed';
import { getBaseAmount, getBaseCurrency, getOriginalBaseAmount } from '@/utils/pricing';
import { useColorMode } from '@/context/ColorModeContext';

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
  const { t, formatDateTime, formatPrice } = useMarket();
  const { colorMode } = useColorMode();

  const addToCart = cartContext?.addToCart || (() => console.warn('addToCart missing'));
  const cartItems = cartContext?.cartItems || [];
  const updateQuantity = cartContext?.updateQuantity || (() => console.warn('updateQuantity missing'));
  const startDirectBuy = useCommerceStore((state) => state.startDirectBuy);

  const toggleWishlist = wishlistContext?.toggleWishlist || (() => console.warn('toggleWishlist missing'));
  const isInWishlist = wishlistContext?.isInWishlist || (() => false);
  const currentUser = authContext?.currentUser || null;

  const [product, setProduct] = useState(null);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
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

  // Preserve string identifiers so AWS/Mongo IDs and numeric catalog IDs both work.
  const productId = id ? String(id) : '';

  // Derived state
  const isWishlisted = typeof isInWishlist === 'function' ? isInWishlist(productId) : false;
  const cartItem = Array.isArray(cartItems)
    ? cartItems.find((item) => String(item?.id || item?._id || '') === productId)
    : undefined;
  const effectiveQuantity = cartItem ? cartItem.quantity : quantity;

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

  useEffect(() => {
    setQuantity(1);
    setActiveImageIndex(0);
  }, [productId]);

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
        setCompatibilityError(error.message || t('productPage.error.compatibility', {}, 'Unable to build compatibility map'));
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
      setReviewsError(error.message || t('productPage.error.loadReviews', {}, 'Unable to load customer reviews'));
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

  const formatMarketPrice = useCallback((amount, baseCurrency = getBaseCurrency(product)) => (
    formatPrice(amount, undefined, undefined, { baseCurrency })
  ), [formatPrice, product]);

  // Handlers
  const handleAddToCart = () => {
    if (product && !cartItem) addToCart(product, quantity);
  };

  const handleBuyNow = () => {
    if (!product) return;

    startDirectBuy(product, effectiveQuantity);

    if (!currentUser) {
      navigate('/login', {
        state: {
          from: {
            pathname: '/checkout',
          },
        },
      });
      return;
    }

    navigate('/checkout');
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
      const suggestedTarget = Math.max(1, Math.round((getBaseAmount(product) || 0) * 0.92));
      const formattedTargetPrice = formatMarketPrice(suggestedTarget, getBaseCurrency(product));
      const response = await priceAlertApi.create(productIdentifier, suggestedTarget);
      setLifecycleNotice(response?.message || t('productPage.priceAlertArmed', {
        price: formattedTargetPrice,
      }, `Price alert armed at ${formattedTargetPrice}.`));
    } catch (error) {
      setLifecycleError(error.message || t('productPage.error.priceAlert', {}, 'Unable to create price alert right now.'));
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
      setReviewSubmitError(t('productPage.error.loginMediaUpload', {}, 'Login is required before media upload.'));
      return;
    }

    const remainingSlots = Math.max(0, 8 - reviewForm.media.length);
    const filesToUpload = incomingFiles.slice(0, remainingSlots);
    if (filesToUpload.length === 0) {
      setReviewSubmitError('You already reached the maximum of 8 media files.');
      return;
    }

    setReviewUploadInProgress(true);
      setReviewUploadMessage(t('productPage.uploadingFiles', { count: filesToUpload.length }, `Uploading ${filesToUpload.length} file(s)...`));
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
      setReviewUploadMessage(t('productPage.uploadedFiles', { count: uploadedMedia.length }, `${uploadedMedia.length} media file(s) uploaded.`));
    } catch (error) {
      setReviewSubmitError(error?.message || t('productPage.error.mediaUpload', {}, 'Media upload failed.'));
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
      setReviewSubmitError(t('productPage.error.invalidMediaUrl', {}, 'Media URL must be an http(s) link or /uploads path.'));
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
      setReviewSubmitError(t('productPage.error.reviewCommentShort', {}, 'Review comment must be at least 8 characters.'));
      return;
    }

    const productIdentifier = product?.id || product?._id;
    if (!productIdentifier) {
      setReviewSubmitError(t('productPage.error.invalidReviewProduct', {}, 'Invalid product for review submission.'));
      return;
    }

    setReviewSubmitting(true);
    try {
      const response = await productApi.createProductReview(productIdentifier, {
        rating: Number(reviewForm.rating),
        comment: trimmedComment,
        media: reviewForm.media,
      });
      setReviewSubmitMessage(response?.message || t('productPage.success.reviewSubmitted', {}, 'Review submitted successfully.'));
      setReviewForm({
        rating: 5,
        comment: '',
        media: [],
      });
      setMediaDraft({ type: 'image', url: '', caption: '' });
      await loadReviews(reviewSort);
    } catch (error) {
      setReviewSubmitError(error.message || t('productPage.error.reviewSubmit', {}, 'Review submission failed.'));
    } finally {
      setReviewSubmitting(false);
    }
  };

  const handleUpdateQty = (delta) => {
    const maxQuantity = Math.max(1, Number(product?.stock || 1));
    const currentQuantity = cartItem ? cartItem.quantity : quantity;
    const newQty = Math.max(1, Math.min(maxQuantity, currentQuantity + delta));
    if (newQty === currentQuantity) return;

    if (cartItem) {
      updateQuantity(productId, newQty);
      return;
    }

    setQuantity(newQty);
  };

  const resolvedProduct = product || {};

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
    warranty = t('productPage.noWarranty', {}, 'No warranty specified'),
    category = 'General',
    subCategory = ''
  } = resolvedProduct;
  const priceCurrency = getBaseCurrency(resolvedProduct);
  const priceValue = getBaseAmount(resolvedProduct);
  const originalPriceValue = getOriginalBaseAmount(resolvedProduct);
  const galleryImages = useMemo(() => {
    const images = [
      image,
      ...(Array.isArray(resolvedProduct?.images) ? resolvedProduct.images : []),
    ]
      .map((entry) => String(entry || '').trim())
      .filter(Boolean);

    return [...new Set(images)];
  }, [image, resolvedProduct?.images]);
  const displayImage = galleryImages[activeImageIndex] || galleryImages[0] || image;
  const heroTitle = displayTitle || title;
  const heroSubtitle = subtitle || subCategory || category;
  const trustGraph = useMemo(
    () => buildProductTrustGraph({ product: resolvedProduct, reviewsSummary, priceHistory }),
    [priceHistory, resolvedProduct, reviewsSummary]
  );
  const tabLabels = {
    description: t('productPage.tab.description', {}, 'Description'),
    specifications: t('productPage.tab.specifications', {}, 'Specifications'),
    'deal-dna': t('productPage.tab.dealDna', {}, 'Deal DNA'),
    compatibility: t('productPage.tab.compatibility', {}, 'Compatibility'),
    reviews: t('productPage.tab.reviews', {}, 'Reviews'),
  };
  const criticalProductDynamicTexts = useMemo(() => ([
    heroTitle,
    heroSubtitle,
    category,
    deliveryTime,
  ]), [category, deliveryTime, heroSubtitle, heroTitle]);
  const secondaryProductDynamicTexts = useMemo(() => ([
    description,
    lifecycleNotice,
    lifecycleError,
    compatibilityError,
    reviewsError,
    reviewSubmitMessage,
    reviewSubmitError,
    reviewUploadMessage,
    ...(Array.isArray(highlights) ? highlights : []),
    ...(Array.isArray(reviewsData)
      ? reviewsData.flatMap((review) => [
        review?.comment,
        ...((Array.isArray(review?.media) ? review.media : []).map((asset) => asset?.caption)),
      ])
      : []),
    ...(Array.isArray(relatedProducts)
      ? relatedProducts.flatMap((item) => [
        item?.displayTitle,
        item?.title,
        item?.subtitle,
        item?.deliveryTime,
        item?.adCampaign?.creativeTagline,
        ...((Array.isArray(item?.highlights) ? item.highlights : [])),
      ])
      : []),
    ...(Array.isArray(compatibilityGraph?.groups)
      ? compatibilityGraph.groups.flatMap((group) => [
        group?.accessoryType,
        ...((Array.isArray(group?.matches) ? group.matches : []).flatMap((item) => [item?.title, item?.category])),
      ])
      : []),
    trustGraph?.headline,
    trustGraph?.summary,
    trustGraph?.label,
    ...(Array.isArray(trustGraph?.metrics)
      ? trustGraph.metrics.flatMap((metric) => [metric?.label, metric?.insight])
      : []),
    ...(Array.isArray(trustGraph?.watchouts) ? trustGraph.watchouts : []),
    ...(Array.isArray(trustGraph?.strengths) ? trustGraph.strengths : []),
  ]), [
    compatibilityError,
    compatibilityGraph,
    description,
    highlights,
    lifecycleError,
    lifecycleNotice,
    relatedProducts,
    reviewSubmitError,
    reviewSubmitMessage,
    reviewUploadMessage,
    reviewsData,
    reviewsError,
    trustGraph,
  ]);
  const deferredProductDynamicTexts = useDeferredValue(secondaryProductDynamicTexts);
  const { translateText: translateProductText } = useDynamicTranslations(criticalProductDynamicTexts);
  useDynamicTranslations(deferredProductDynamicTexts, {
    enabled: deferredProductDynamicTexts.length > 0,
  });
  const translatedHeroTitle = translateProductText(heroTitle) || heroTitle;
  const translatedHeroSubtitle = translateProductText(heroSubtitle) || heroSubtitle;
  const translatedCategory = translateProductText(category) || category;
  const translatedDescription = translateProductText(description) || description;
  const translatedDeliveryTime = translateProductText(deliveryTime) || deliveryTime;
  const translatedHighlights = useMemo(
    () => (Array.isArray(highlights) ? highlights.map((highlight) => translateProductText(highlight) || highlight) : []),
    [highlights, translateProductText]
  );
  const translatedRelatedProducts = useMemo(() => (
    Array.isArray(relatedProducts)
      ? relatedProducts.map((item) => ({
        ...item,
        displayTitle: item?.displayTitle ? (translateProductText(item.displayTitle) || item.displayTitle) : item?.displayTitle,
        title: translateProductText(item?.title) || item?.title,
        subtitle: translateProductText(item?.subtitle) || item?.subtitle,
        deliveryTime: translateProductText(item?.deliveryTime) || item?.deliveryTime,
        highlights: Array.isArray(item?.highlights)
          ? item.highlights.map((highlight) => translateProductText(highlight) || highlight)
          : item?.highlights,
        adCampaign: item?.adCampaign
          ? {
            ...item.adCampaign,
            creativeTagline: translateProductText(item.adCampaign.creativeTagline) || item.adCampaign.creativeTagline,
          }
          : item?.adCampaign,
      }))
      : []
  ), [relatedProducts, translateProductText]);
  const translatedCompatibilityGroups = useMemo(() => (
    Array.isArray(compatibilityGraph?.groups)
      ? compatibilityGraph.groups.map((group) => ({
        ...group,
        accessoryTypeLabel: translateProductText(group?.accessoryType) || group?.accessoryType,
        matches: Array.isArray(group?.matches)
          ? group.matches.map((item) => ({
            ...item,
            translatedTitle: translateProductText(item?.title) || item?.title,
            category: translateProductText(item?.category) || item?.category,
          }))
          : [],
      }))
      : []
  ), [compatibilityGraph, translateProductText]);
  const translatedTrustGraph = useMemo(() => ({
    ...trustGraph,
    label: translateProductText(trustGraph?.label) || trustGraph?.label,
    headline: translateProductText(trustGraph?.headline) || trustGraph?.headline,
    summary: translateProductText(trustGraph?.summary) || trustGraph?.summary,
    metrics: Array.isArray(trustGraph?.metrics)
      ? trustGraph.metrics.map((metric) => ({
        ...metric,
        label: translateProductText(metric?.label) || metric?.label,
        insight: translateProductText(metric?.insight) || metric?.insight,
      }))
      : [],
    strengths: Array.isArray(trustGraph?.strengths)
      ? trustGraph.strengths.map((item) => translateProductText(item) || item)
      : [],
    watchouts: Array.isArray(trustGraph?.watchouts)
      ? trustGraph.watchouts.map((item) => translateProductText(item) || item)
      : [],
  }), [translateProductText, trustGraph]);

  const dealDna = resolvedProduct?.dealDna || null;
  const dealTone = dealDna?.verdict === 'good_deal'
    ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100'
    : dealDna?.verdict === 'avoid'
      ? 'border-rose-400/40 bg-rose-500/15 text-rose-100'
      : 'border-amber-400/40 bg-amber-500/15 text-amber-100';
  const dealLabel = dealDna?.verdict === 'good_deal'
    ? t('product.goodDeal', {}, 'Good Deal')
    : dealDna?.verdict === 'avoid'
      ? t('product.avoid', {}, 'Avoid')
      : dealDna?.verdict === 'wait'
        ? t('product.wait', {}, 'Wait')
        : t('product.review', {}, 'Review');
  const trustToneClass = translatedTrustGraph.tone === 'emerald'
    ? 'border-emerald-400/35 bg-emerald-500/10 text-emerald-100'
    : translatedTrustGraph.tone === 'amber'
      ? 'border-amber-400/35 bg-amber-500/10 text-amber-100'
      : translatedTrustGraph.tone === 'rose'
        ? 'border-rose-400/35 bg-rose-500/10 text-rose-100'
        : 'border-neo-cyan/35 bg-neo-cyan/10 text-neo-cyan';
  const isStylishWhite = colorMode === 'white';
  const strongTextClass = isStylishWhite ? 'text-slate-950' : 'text-white';
  const bodyTextClass = isStylishWhite ? 'text-slate-700' : 'text-slate-300';
  const mutedTextClass = isStylishWhite ? 'text-slate-600' : 'text-slate-400';
  const subtleTextClass = isStylishWhite ? 'text-slate-500' : 'text-slate-500';
  const mediaCardClass = isStylishWhite
    ? 'border-slate-200/80 bg-[linear-gradient(145deg,rgba(255,255,255,0.97),rgba(241,245,249,0.92))] shadow-[0_24px_70px_rgba(148,163,184,0.18)] ring-slate-200/70'
    : 'border-white/10 bg-[linear-gradient(145deg,rgba(35,29,24,0.95),rgba(9,22,23,0.88)_48%,rgba(8,12,18,0.92))] shadow-[0_24px_70px_rgba(2,8,12,0.34)] ring-white/10';
  const mediaFrameClass = isStylishWhite
    ? 'border-slate-200/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(226,232,240,0.9)_58%,rgba(203,213,225,0.92)_100%)]'
    : 'border-white/10 bg-[linear-gradient(135deg,rgba(250,246,235,0.94),rgba(226,232,240,0.74)_58%,rgba(148,163,184,0.58)_100%)]';
  const floatingActionClass = isStylishWhite
    ? 'border-slate-200/80 bg-white/90 shadow-[0_12px_28px_rgba(148,163,184,0.22)]'
    : 'border-white/10 bg-zinc-950/65 shadow-[0_0_15px_rgba(0,0,0,0.5)]';
  const heroCardClass = isStylishWhite
    ? 'border-slate-200/80 bg-[linear-gradient(140deg,rgba(255,255,255,0.96),rgba(241,245,249,0.9)_46%,rgba(226,232,240,0.84)_100%)] shadow-[0_28px_90px_rgba(148,163,184,0.2)] ring-slate-200/60'
    : 'border-white/10 bg-[linear-gradient(140deg,rgba(35,29,24,0.88),rgba(9,22,23,0.68)_46%,rgba(8,12,18,0.72)_100%)] shadow-[0_28px_90px_rgba(2,8,12,0.34)] ring-white/5';
  const surfaceCardClass = isStylishWhite
    ? 'border-slate-200/80 bg-white/82 shadow-[0_18px_40px_rgba(148,163,184,0.14)]'
    : 'border-white/10 bg-zinc-950/45';
  const softPanelClass = isStylishWhite
    ? 'border-slate-200/80 bg-slate-50/90 shadow-[0_14px_32px_rgba(148,163,184,0.14)]'
    : 'border-white/10 bg-white/5';
  const statCardClass = isStylishWhite
    ? 'border-slate-200/80 bg-white/84 shadow-[0_18px_40px_rgba(148,163,184,0.16)]'
    : 'border-white/10 bg-white/[0.045]';
  const reviewChipClass = isStylishWhite
    ? 'border-slate-200/80 bg-white/88 text-slate-600'
    : 'border-white/5 bg-white/5 text-slate-400';
  const actionButtonClass = isStylishWhite
    ? 'border-slate-200/80 bg-white/88 text-slate-800 shadow-[0_12px_30px_rgba(148,163,184,0.16)]'
    : 'border-white/15 bg-white/5 text-slate-100';
  const pillButtonClass = isStylishWhite
    ? 'border-slate-200/80 bg-white/88 text-slate-800 shadow-[0_10px_24px_rgba(148,163,184,0.12)]'
    : 'border-white/15 bg-white/5 text-slate-100';
  const mobileBuybarClass = isStylishWhite
    ? 'border-slate-200/80 bg-white/98 shadow-[0_-18px_48px_rgba(148,163,184,0.22)]'
    : 'border-white/10 bg-zinc-950 shadow-[0_-18px_48px_rgba(0,0,0,0.42)]';
  const inputClass = isStylishWhite
    ? 'border-slate-200/80 bg-white text-slate-900 shadow-sm placeholder:text-slate-400'
    : 'border-white/15 bg-zinc-950/70 text-white';
  const productImageClass = isStylishWhite
    ? 'relative z-10 h-full w-full object-contain drop-shadow-[0_24px_60px_rgba(148,163,184,0.35)] transition-transform duration-700 group-hover:scale-[1.05]'
    : 'relative z-10 h-full w-full object-contain drop-shadow-[0_24px_60px_rgba(15,23,42,0.48)] transition-transform duration-700 group-hover:scale-[1.05]';

  if (isLoading) {
    return <ProductPageSkeleton />;
  }

  if (!product) {
    return (
      <div className="container-custom max-w-7xl mx-auto py-20 px-4 text-center">
        <div className={cn('border rounded-3xl p-12 max-w-2xl mx-auto shadow-glass relative overflow-hidden group', isStylishWhite ? 'bg-white/92 border-slate-200/80' : 'bg-white/5 border-white/10')}>
          <div className="absolute inset-0 bg-gradient-to-br from-neo-cyan/5 to-neo-rose/5 pointer-events-none" />
          <h2 className={cn('text-3xl font-black mb-6 tracking-widest uppercase', strongTextClass)}>{t('productPage.notFoundTitle', {}, 'Product Not Found')}</h2>
          <p className={cn('mb-8', mutedTextClass)}>{t('productPage.notFoundBody', {}, 'The item you are looking for could not be found.')}</p>
          <Link to="/" className="btn-primary inline-block px-10 py-3">{t('productPage.continueShopping', {}, 'Continue Shopping')}</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="product-details-shell relative min-h-screen min-w-0 overflow-x-hidden pb-32 pt-3 sm:pt-4 lg:pb-16">
      <div className="product-detail-page-texture pointer-events-none absolute inset-x-0 top-0 -z-10 h-[36rem]" />

      <div className={cn(
        'container-custom mx-auto max-w-7xl min-w-0 px-3 py-4 sm:px-4 md:px-6 md:py-6',
        isStylishWhite ? 'border-t border-slate-200/80' : 'border-t border-white/5'
      )}>
        {/* Breadcrumb */}
        <nav className="mb-5 flex flex-wrap items-center gap-y-2 text-[9px] font-bold uppercase tracking-widest text-slate-500 sm:mb-8 sm:text-[10px] md:text-sm">
          <Link to="/" className="hover:text-neo-cyan transition-colors">Aura</Link>
          <ChevronRight className="w-4 h-4 mx-2 text-slate-700" />
          <Link to={`/category/${(category || 'all').toLowerCase().replace(/\s+/g, '-')}`} className="hover:text-neo-cyan transition-colors">
            {translatedCategory}
          </Link>
          <ChevronRight className="w-4 h-4 mx-2 text-slate-700" />
          <span className={cn('truncate max-w-[200px] md:max-w-md', strongTextClass)}>{translatedHeroTitle}</span>
        </nav>

        <div className="grid min-w-0 gap-6 lg:grid-cols-12 lg:items-start lg:gap-12">
          {/* Left Column: Image & Buttons */}
          <div className="flex min-w-0 flex-col gap-4 sm:gap-6 lg:col-span-5 lg:self-start">
            <div className="lg:sticky lg:top-28 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto lg:pr-2">
              <div className="flex min-w-0 flex-col gap-4 sm:gap-6 lg:pb-4">
                <div className={cn(
                  'product-detail-media-panel group relative min-w-0 overflow-hidden rounded-[1.9rem] border p-4 ring-1 sm:rounded-[2.15rem] sm:p-6',
                  mediaCardClass
                )}>
                  <div className="product-detail-media-wash absolute inset-0 pointer-events-none" />
                  <div className={cn(
                    'product-detail-media-frame relative flex min-w-0 aspect-square items-center justify-center overflow-hidden rounded-[1.6rem] border p-2 sm:rounded-[1.9rem] sm:p-4',
                    mediaFrameClass
                  )}>
                    <div className="product-detail-media-rule absolute inset-x-8 bottom-8 h-px" />
                    <div className={cn(
                      'absolute left-16 top-4 z-20 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em]',
                      isStylishWhite
                        ? 'border-slate-900/10 bg-white/75 text-slate-700'
                        : 'border-white/10 bg-zinc-950/50 text-slate-200'
                    )}>
                      {t('productPage.mediaLive', {}, 'Live media')}
                    </div>
                    <img
                      src={displayImage}
                      alt={translatedHeroTitle}
                      className={productImageClass}
                    />

                    <button
                      type="button"
                      onClick={() => toggleWishlist(product)}
                      aria-label={isWishlisted
                        ? t('product.removeFromWishlist', {}, 'Remove from wishlist')
                        : t('product.addToWishlist', {}, 'Add to wishlist')}
                      className={cn(
                        'absolute right-4 top-4 z-20 rounded-full border p-2.5 transition-all duration-300 hover:border-neo-rose hover:bg-neo-rose/10 group/btn sm:p-3',
                        floatingActionClass
                      )}
                    >
                      <Heart className={cn('w-6 h-6 transition-colors', isWishlisted ? 'fill-neo-rose text-neo-rose drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]' : `${mutedTextClass} group-hover/btn:text-neo-rose`)} />
                    </button>

                    <button
                      type="button"
                      onClick={() => navigator?.share?.({ title: translatedHeroTitle, url: window.location.href })}
                      aria-label={t('product.share', {}, 'Share product')}
                      className={cn(
                        'absolute left-4 top-4 z-20 rounded-full border p-2.5 transition-all duration-300 hover:border-neo-cyan hover:bg-neo-cyan/10 group/btn sm:p-3',
                        floatingActionClass
                      )}
                    >
                      <Share2 className={cn('w-5 h-5 group-hover/btn:text-neo-cyan transition-colors', mutedTextClass)} />
                    </button>

                  </div>

                  {galleryImages.length > 1 && (
                    <div className="mt-4 grid grid-cols-4 gap-2">
                      {galleryImages.slice(0, 4).map((asset, index) => (
                        <button
                          key={`${asset}-${index}`}
                          type="button"
                          onClick={() => setActiveImageIndex(index)}
                          aria-label={t('productPage.viewImage', { index: index + 1 }, `View product image ${index + 1}`)}
                          className={cn(
                            'product-detail-gallery-thumb aspect-square min-w-0 overflow-hidden rounded-2xl border p-1 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-neo-cyan/70',
                            activeImageIndex === index
                              ? 'border-neo-cyan/70 bg-neo-cyan/10 shadow-[0_12px_28px_rgba(6,182,212,0.14)]'
                              : isStylishWhite
                                ? 'border-slate-200/80 bg-white/72 hover:border-slate-300'
                                : 'border-white/10 bg-white/[0.04] hover:border-white/20'
                          )}
                        >
                          <img src={asset} alt="" className="h-full w-full rounded-xl object-contain" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <section className="product-detail-assurance-grid grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
                  <div className={cn('product-detail-stat-card rounded-[1.1rem] border p-3 sm:p-4', statCardClass)}>
                    <p className={cn('text-[10px] font-black uppercase tracking-[0.16em]', mutedTextClass)}>
                      {t('productPage.fulfillment', {}, 'Fulfillment')}
                    </p>
                    <div className="mt-2 flex items-start gap-2.5 sm:mt-3 sm:gap-3">
                      <Truck className="mt-0.5 h-4 w-4 shrink-0 text-neo-cyan sm:h-5 sm:w-5" />
                      <div className="min-w-0">
                        <p className={cn('text-sm font-black sm:text-base', strongTextClass)}>{translatedDeliveryTime}</p>
                        <p className={cn('product-detail-stat-card__body mt-1 text-xs leading-relaxed', mutedTextClass)}>
                          {t('productPage.deliveryPromise', {}, 'Priority routing with live order tracking at checkout')}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className={cn('product-detail-stat-card rounded-[1.1rem] border p-3 sm:p-4', statCardClass)}>
                    <p className={cn('text-[10px] font-black uppercase tracking-[0.16em]', mutedTextClass)}>
                      {t('productPage.inventorySignal', {}, 'Inventory')}
                    </p>
                    <div className="mt-2 flex items-start gap-2.5 sm:mt-3 sm:gap-3">
                      <PackageCheck className={cn('mt-0.5 h-4 w-4 shrink-0 sm:h-5 sm:w-5', stock > 0 ? 'text-neo-emerald' : 'text-neo-rose')} />
                      <div className="min-w-0">
                        <p className={cn('text-sm font-black sm:text-base', stock > 0 ? 'text-neo-emerald' : 'text-neo-rose')}>
                          {stock > 0
                            ? t('productPage.inStockAvailable', { count: stock }, `In Stock (${stock} Available)`)
                            : t('productPage.outOfStock', {}, 'Out of Stock')}
                        </p>
                        <p className={cn('product-detail-stat-card__body mt-1 text-xs leading-relaxed', mutedTextClass)}>
                          {t('productPage.stockChecked', {}, 'Checked against the live AWS catalog before checkout')}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className={cn('product-detail-stat-card rounded-[1.1rem] border p-3 sm:p-4', statCardClass)}>
                    <p className={cn('text-[10px] font-black uppercase tracking-[0.16em]', mutedTextClass)}>
                      {t('productPage.coverage', {}, 'Coverage')}
                    </p>
                    <div className="mt-2 flex items-start gap-2.5 sm:mt-3 sm:gap-3">
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-200 sm:h-5 sm:w-5" />
                      <div className="min-w-0">
                        <p className={cn('text-sm font-black sm:text-base', strongTextClass)}>{warranty}</p>
                        <p className={cn('product-detail-stat-card__body mt-1 text-xs leading-relaxed', mutedTextClass)}>
                          {t('productPage.premiumProtection', {}, 'Protected by Aura verification and support flows')}
                        </p>
                      </div>
                    </div>
                  </div>
                </section>

              </div>
            </div>

            {/* Mobile Actions - Sticky Bottom */}
            <div
              className={cn(
                'product-detail-mobile-buybar fixed bottom-0 left-0 right-0 z-50 flex min-w-0 gap-3 border-t px-3 pb-[calc(0.85rem+env(safe-area-inset-bottom))] pt-3 sm:gap-4 sm:p-4 lg:hidden',
                mobileBuybarClass
              )}
              style={{ width: '100dvw', maxWidth: '100dvw' }}
            >
              {cartItem ? (
                <div className="flex min-w-0 flex-1 items-center justify-center gap-4 rounded-2xl border border-neo-cyan/40 bg-neo-cyan/10 px-3 py-3 shadow-[0_0_15px_rgba(6,182,212,0.12)]">
                  <button
                    type="button"
                    onClick={() => handleUpdateQty(-1)}
                    disabled={cartItem.quantity <= 1}
                    aria-label={`Decrease quantity for ${translatedHeroTitle}`}
                    className="text-neo-cyan transition-colors hover:text-white disabled:opacity-50"
                  >
                    <Minus className="w-5 h-5" />
                  </button>
                  <span className={cn('min-w-[2rem] text-center text-lg font-black', strongTextClass)}>{cartItem.quantity}</span>
                  <button
                    type="button"
                    onClick={() => handleUpdateQty(1)}
                    disabled={cartItem.quantity >= stock}
                    aria-label={`Increase quantity for ${translatedHeroTitle}`}
                    className="text-neo-cyan transition-colors hover:text-white disabled:opacity-50"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleAddToCart}
                  disabled={stock === 0}
                  className="relative flex min-w-0 flex-1 items-center justify-center gap-2 overflow-hidden border-white/20 py-3.5 text-[11px] tracking-[0.18em] shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)] btn-secondary group"
                >
                  <ShoppingCart className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
                  <span className="relative z-10 truncate">{t('product.addToBag', {}, 'Add to Bag')}</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleBuyNow}
                disabled={stock === 0}
                className="relative min-w-0 flex-1 overflow-hidden py-3.5 text-[11px] tracking-[0.18em] shadow-[0_0_15px_rgba(217,70,239,0.3)] btn-primary group"
              >
                <span className="relative z-10 flex min-w-0 items-center justify-center gap-2">
                  <Zap className="w-4 h-4 shrink-0 fill-white animate-pulse" />
                  <span className="truncate">{t('productPage.buyNow', {}, 'Buy Now')}</span>
                </span>
                <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
              </button>
            </div>
          </div>

          {/* Right Column: Details */}
          <div className="min-w-0 lg:col-span-7">
            <div className={cn(
              'product-detail-hero-panel relative min-w-0 overflow-hidden rounded-[1.9rem] border p-5 ring-1 sm:rounded-[2.2rem] sm:p-6 md:p-10',
              heroCardClass
            )}>
              <div className="product-detail-hero-panel__wash absolute inset-0 pointer-events-none" />
              <div className="product-detail-hero-panel__rule absolute inset-x-8 top-6 h-px pointer-events-none" />
              <div className="product-detail-hero-panel__glow absolute bottom-0 right-0 h-[55%] w-[55%] pointer-events-none" />

              <div className="relative z-10 min-w-0">
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <p className={cn('rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.28em] text-neo-cyan', isStylishWhite ? 'border-slate-200/80 bg-white/88' : 'border-white/10 bg-white/5')}>{brand}</p>
                </div>
                {translatedHeroSubtitle && (
                  <p className={cn('mb-3 text-xs font-semibold uppercase tracking-[0.22em]', mutedTextClass)}>
                    {translatedHeroSubtitle}
                  </p>
                )}
                <h1 className={cn('mb-5 text-[1.9rem] font-black leading-tight tracking-tighter sm:text-3xl md:mb-6 md:text-5xl', strongTextClass)}>
                  {translatedHeroTitle}
                </h1>
                <div className="mb-6 flex flex-wrap items-center gap-2.5 sm:gap-4 md:mb-8">
                  <span className="rating-badge text-sm px-3 py-1 shadow-[0_0_10px_rgba(250,204,21,0.3)]">
                    {rating}<Star className="w-3 h-3 fill-zinc-950 ml-1" />
                  </span>
                  <span className={cn('font-medium text-sm tracking-wide px-3 py-1 rounded-full border', reviewChipClass)}>
                    {t('productPage.reviewsCount', { count: ratingCount.toLocaleString() }, `${ratingCount.toLocaleString()} Reviews`)}
                  </span>
                  {dealDna && (
                    <span className={cn('text-[10px] px-3 py-1 rounded-full border font-black uppercase tracking-widest inline-flex items-center gap-1.5', dealTone)}>
                      <BadgeCheck className="w-3 h-3" />
                      {t('productPage.dealDnaScore', { score: dealDna.score, label: dealLabel }, `Deal DNA ${dealDna.score} â€¢ ${dealLabel}`)}
                    </span>
                  )}
                </div>

                <div className="mb-8">
                  <div className={cn('product-detail-buy-panel rounded-[1.7rem] border p-5 sm:p-6', surfaceCardClass)}>
                    <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
                      <div className="min-w-0">
                        <p className={cn('text-[10px] font-black uppercase tracking-[0.22em]', mutedTextClass)}>
                          {t('productPage.livePrice', {}, 'Price')}
                        </p>
                        <div className="mt-3 flex flex-wrap items-end gap-3 sm:gap-4">
                          <span className={cn('text-4xl font-black tracking-tighter sm:text-5xl', strongTextClass)}>
                            {formatMarketPrice(priceValue, priceCurrency)}
                          </span>
                          {originalPriceValue > priceValue && (
                            <span className={cn('pb-1 text-lg font-medium line-through', mutedTextClass)}>
                              {formatMarketPrice(originalPriceValue, priceCurrency)}
                            </span>
                          )}
                          {discountPercentage > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-neo-cyan/20 bg-neo-cyan/10 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-neo-cyan">
                              <Zap className="h-3 w-3 fill-neo-cyan" />
                              {t('product.off', {}, '% off').replace('%', String(discountPercentage))}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className={cn(
                          'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-black uppercase tracking-[0.14em]',
                          stock > 0
                            ? 'border-neo-emerald/25 bg-neo-emerald/10 text-neo-emerald'
                            : 'border-neo-rose/25 bg-neo-rose/10 text-neo-rose'
                        )}>
                          <span className={cn('h-2 w-2 rounded-full', stock > 0 ? 'bg-neo-emerald' : 'bg-neo-rose')} />
                          {stock > 0
                            ? t('productPage.inStockAvailable', { count: stock }, `In Stock (${stock} Available)`)
                            : t('productPage.outOfStock', {}, 'Out of Stock')}
                        </span>
                        <span className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-black uppercase tracking-[0.14em]', actionButtonClass)}>
                          <Truck className="h-3.5 w-3.5" />
                          {translatedDeliveryTime}
                        </span>
                      </div>
                    </div>

                    <div className="mt-5 hidden flex-col gap-3 lg:flex xl:flex-row xl:items-center">
                      {cartItem ? (
                        <div className="flex items-center justify-center gap-6 rounded-2xl border-2 border-neo-cyan/50 bg-neo-cyan/5 px-6 py-3 shadow-[0_0_15px_rgba(6,182,212,0.1)]">
                          <button
                            type="button"
                            onClick={() => handleUpdateQty(-1)}
                            disabled={cartItem.quantity <= 1}
                            aria-label={`Decrease quantity for ${translatedHeroTitle}`}
                            className="text-neo-cyan transition-colors hover:text-white disabled:opacity-50"
                          >
                            <Minus className="w-6 h-6" />
                          </button>
                          <span className={cn('w-8 text-center text-2xl font-black', strongTextClass)}>{cartItem.quantity}</span>
                          <button
                            type="button"
                            onClick={() => handleUpdateQty(1)}
                            disabled={cartItem.quantity >= stock}
                            aria-label={`Increase quantity for ${translatedHeroTitle}`}
                            className="text-neo-cyan transition-colors hover:text-white disabled:opacity-50"
                          >
                            <Plus className="w-6 h-6" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={handleAddToCart}
                          disabled={stock === 0}
                          className="btn-secondary inline-flex min-w-[13rem] items-center justify-center gap-3 border-white/20 px-8 py-4 text-sm tracking-widest group/add"
                        >
                          <ShoppingCart className="w-5 h-5 transition-transform group-hover/add:-translate-x-1" />
                          <span className="relative z-10">{t('product.addToBag', {}, 'Add to Bag')}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleBuyNow}
                        disabled={stock === 0}
                        className="btn-primary inline-flex min-w-[12rem] items-center justify-center gap-2 px-8 py-4 text-sm tracking-widest shadow-[0_0_20px_rgba(16,185,129,0.3)] group/buy"
                      >
                        <Zap className="w-4 h-4 fill-white group-hover/buy:animate-pulse" />
                        <span className="relative z-10">{t('productPage.buyNow', {}, 'Buy Now')}</span>
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <button
                    onClick={handleOpenCompare}
                    className={cn('rounded-xl border px-4 py-3 text-sm font-black uppercase tracking-widest hover:border-neo-cyan/45 hover:text-neo-cyan transition-colors inline-flex items-center justify-center gap-2', actionButtonClass)}
                  >
                    <Brain className="w-4 h-4" />
                    {t('nav.aiCompare', {}, 'AI Compare')}
                  </button>
                  <button
                    onClick={handleOpenVisualSearch}
                    className={cn('rounded-xl border px-4 py-3 text-sm font-black uppercase tracking-widest hover:border-neo-emerald/45 hover:text-neo-emerald transition-colors inline-flex items-center justify-center gap-2', actionButtonClass)}
                  >
                    <Camera className="w-4 h-4" />
                    {t('nav.visualSearch', {}, 'Visual Search')}
                  </button>
                  <button
                    type="button"
                    onClick={handleSetPriceAlert}
                    className={cn('rounded-xl border px-4 py-3 text-sm font-black uppercase tracking-widest hover:border-violet-400/45 hover:text-violet-300 transition-colors inline-flex items-center justify-center gap-2', actionButtonClass)}
                  >
                    <Zap className="w-4 h-4" />
                    {t('productPage.setPriceAlert', {}, 'Set price alert')}
                  </button>
                </div>

                <section className={cn('mb-8 rounded-2xl border p-4 sm:p-5 lg:mb-12', surfaceCardClass)}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-neo-cyan">
                        {t('productPage.trustGraph', {}, 'Trust Graph')}
                      </p>
                      <h2 className={cn('mt-2 text-xl font-black', strongTextClass)}>{translatedTrustGraph.headline}</h2>
                      <p className={cn('mt-3 text-sm leading-relaxed', bodyTextClass)}>{translatedTrustGraph.summary}</p>
                    </div>
                    <div className={cn('rounded-full border px-3 py-1.5 text-xs font-black uppercase tracking-[0.14em]', trustToneClass)}>
                      {t('productPage.trustScoreLabel', { score: translatedTrustGraph.overallScore }, `Trust ${translatedTrustGraph.overallScore}`)}
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className={cn('rounded-xl border px-4 py-3', softPanelClass)}>
                      <p className={cn('text-[11px] font-black uppercase tracking-[0.14em]', mutedTextClass)}>
                        {t('productPage.dealVerdict', {}, 'Deal verdict')}
                      </p>
                      <p className={cn('mt-2 text-base font-black', strongTextClass)}>{dealLabel}</p>
                    </div>
                    <div className={cn('rounded-xl border px-4 py-3', softPanelClass)}>
                      <p className={cn('text-[11px] font-black uppercase tracking-[0.14em]', mutedTextClass)}>
                        {t('productPage.deliveryTime', {}, 'Delivery time')}
                      </p>
                      <p className={cn('mt-2 text-base font-black', strongTextClass)}>{translatedDeliveryTime}</p>
                    </div>
                    <div className={cn('rounded-xl border px-4 py-3', softPanelClass)}>
                      <p className={cn('text-[11px] font-black uppercase tracking-[0.14em]', mutedTextClass)}>
                        {t('productPage.warranty', {}, 'Warranty')}
                      </p>
                      <p className={cn('mt-2 text-base font-black', strongTextClass)}>{warranty}</p>
                    </div>
                  </div>
                  {(lifecycleNotice || lifecycleError) && (
                    <div className={cn(
                      'mt-4 rounded-xl border px-3 py-2 text-sm',
                      lifecycleError
                        ? 'border-rose-400/30 bg-rose-500/10 text-rose-100'
                        : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'
                    )}>
                      {translateProductText(lifecycleError || lifecycleNotice)}
                    </div>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveTab('compatibility')}
                      className={cn('rounded-full border px-4 py-2 text-sm font-bold hover:border-neo-cyan/45 hover:text-neo-cyan transition-colors', pillButtonClass)}
                    >
                      {t('productPage.tab.compatibility', {}, 'Compatibility')}
                    </button>
                    <Link
                      to="/trade-in"
                      className={cn('rounded-full border px-4 py-2 text-sm font-bold hover:border-emerald-400/45 hover:text-emerald-300 transition-colors', pillButtonClass)}
                    >
                      {t('productPage.tradeInPath', {}, 'Trade-in path')}
                    </Link>
                  </div>
                </section>

                {/* Tabs */}
                <div className="border-t border-white/10 pt-6 sm:pt-8">
                  <div className="-mx-5 mb-6 flex gap-6 overflow-x-auto border-b border-white/5 px-5 scrollbar-hide sm:mx-0 sm:mb-8 sm:gap-8 sm:px-0">
                    {['description', 'specifications', 'deal-dna', 'compatibility', 'reviews'].map(tab => (
                      <button key={tab} onClick={() => setActiveTab(tab)}
                        data-testid={`product-tab-${tab}`}
                        className={cn('pb-4 text-xs md:text-sm font-bold tracking-widest uppercase transition-colors relative whitespace-nowrap',
                          activeTab === tab ? 'text-neo-cyan' : 'text-slate-500 hover:text-slate-300')}>
                        {tabLabels[tab] || tab}
                        {activeTab === tab && (
                          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-neo-cyan to-neo-emerald shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
                        )}
                      </button>
                    ))}
                  </div>

                  <div className={cn('min-h-[200px] animate-fade-in', bodyTextClass)}>
                    {activeTab === 'description' && (
                      <div className="space-y-8">
                        <p className="text-base font-medium leading-relaxed sm:text-lg">{translatedDescription}</p>
                        {translatedHighlights.length > 0 && (
                          <div className={cn('p-6 rounded-2xl border', isStylishWhite ? 'border-slate-200/80 bg-slate-50/92 shadow-[0_14px_32px_rgba(148,163,184,0.14)]' : 'bg-zinc-950/50 border-white/5')}>
                            <h3 className="font-bold mb-4 uppercase tracking-widest text-sm text-neo-emerald">{t('productPage.coreSpecs', {}, 'Core Specs:')}</h3>
                            <ul className="space-y-3">
                              {translatedHighlights.map((h, i) => (
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
                        <div className={cn('p-5 rounded-xl border flex flex-col gap-1', isStylishWhite ? 'border-slate-200/80 bg-slate-50/92 shadow-[0_14px_32px_rgba(148,163,184,0.14)]' : 'bg-zinc-950/50 border-white/5')}>
                          <span className={cn('text-xs uppercase tracking-widest font-bold', subtleTextClass)}>{t('productPage.manufacturer', {}, 'Manufacturer')}</span>
                          <p className={cn('font-medium text-lg', strongTextClass)}>{brand}</p>
                        </div>
                        <div className={cn('p-5 rounded-xl border flex flex-col gap-1', isStylishWhite ? 'border-slate-200/80 bg-slate-50/92 shadow-[0_14px_32px_rgba(148,163,184,0.14)]' : 'bg-zinc-950/50 border-white/5')}>
                          <span className={cn('text-xs uppercase tracking-widest font-bold', subtleTextClass)}>{t('productPage.warranty', {}, 'Warranty')}</span>
                          <p className={cn('font-medium text-lg', strongTextClass)}>{warranty}</p>
                        </div>
                        <div className={cn('p-5 rounded-xl border flex flex-col gap-1 md:col-span-2', isStylishWhite ? 'border-slate-200/80 bg-slate-50/92 shadow-[0_14px_32px_rgba(148,163,184,0.14)]' : 'bg-zinc-950/50 border-white/5')}>
                          <span className={cn('text-xs uppercase tracking-widest font-bold', subtleTextClass)}>{t('productPage.deliveryTime', {}, 'Delivery Time')}</span>
                          <p className={cn('font-medium text-lg', strongTextClass)}>{translatedDeliveryTime}</p>
                        </div>
                      </div>
                    )}

                    {activeTab === 'deal-dna' && (
                      <div className="space-y-4">
                        {!dealDna ? (
                          <p className={cn('text-sm', mutedTextClass)}>{t('productPage.dealDnaUnavailable', {}, 'Deal DNA is not available for this product yet.')}</p>
                        ) : (
                          <>
                            <div className={cn('rounded-2xl border p-5', dealTone)}>
                              <p className="text-xs font-black uppercase tracking-[0.16em]">{t('productPage.trustVerdict', {}, 'Trust Verdict')}</p>
                              <p className="mt-2 text-2xl font-black">{dealLabel} â€¢ Score {dealDna.score}/100</p>
                              <p className="mt-2 text-sm text-slate-100/90">{dealDna.message}</p>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                              {Object.entries(dealDna.components || {}).map(([key, value]) => (
                                <div key={key} className={cn('rounded-xl border px-3 py-2', softPanelClass)}>
                                  <p className={cn('text-[10px] uppercase tracking-wider font-bold', mutedTextClass)}>{key}</p>
                                  <p className={cn('text-lg font-black', strongTextClass)}>{value}</p>
                                </div>
                              ))}
                            </div>
                            {(dealDna.returnRisk?.reasons || []).length > 0 && (
                              <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-4">
                                <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-200 mb-2">{t('productPage.returnRiskDrivers', {}, 'Return Risk Drivers')}</p>
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
                          <p className={cn('text-sm', mutedTextClass)}>{t('productPage.buildingCompatibility', {}, 'Building compatibility graph...')}</p>
                        )}
                        {!compatibilityLoading && compatibilityError && (
                          <p className="text-sm text-rose-300">{translateProductText(compatibilityError)}</p>
                        )}
                        {!compatibilityLoading && !compatibilityError && translatedCompatibilityGroups.length === 0 && (
                          <p className={cn('text-sm', mutedTextClass)}>{t('productPage.noCompatibility', {}, 'No compatibility data available for this category yet.')}</p>
                        )}
                        {!compatibilityLoading && !compatibilityError && translatedCompatibilityGroups.length > 0 && (
                          <div className="space-y-4">
                            {translatedCompatibilityGroups.map((group) => (
                              <div key={group.accessoryType} className={cn('rounded-2xl border p-4', surfaceCardClass)}>
                                <p className="text-xs font-black uppercase tracking-[0.16em] text-neo-cyan mb-3">
                                  {group.accessoryTypeLabel}
                                </p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  {(group.matches || []).map((item) => (
                                    <Link
                                      key={`${group.accessoryType}-${item.id}`}
                                      to={`/product/${item.id}`}
                                      className={cn('rounded-xl border p-3 hover:border-neo-emerald/45 transition-colors', softPanelClass)}
                                    >
                                      <div className="flex items-center gap-3">
                                        <img src={item.image} alt={item.translatedTitle} className="w-14 h-14 rounded-lg object-cover bg-zinc-900/70" />
                                        <div className="min-w-0">
                                          <p className={cn('text-sm font-bold truncate', strongTextClass)}>{item.translatedTitle}</p>
                                          <p className={cn('text-xs truncate', mutedTextClass)}>{item.brand} â€¢ {item.category}</p>
                                          <p className="text-xs text-neo-cyan font-bold mt-1">
                                            {t('productPage.compatibilityScore', { score: item.compatibilityScore }, `Compatibility ${item.compatibilityScore}/100`)}
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
                          <div className={cn('lg:col-span-1 rounded-2xl border p-5', surfaceCardClass)}>
                            <p className={cn('text-xs uppercase tracking-[0.16em] font-bold', mutedTextClass)}>{t('productPage.communityScore', {}, 'Community Score')}</p>
                            <p className={cn('mt-2 text-4xl font-black', strongTextClass)}>{Number(reviewsSummary.averageRating || 0).toFixed(1)}</p>
                            <p className={cn('mt-1 text-sm', mutedTextClass)}>
                              {t('productPage.verifiedReviews', { count: Number(reviewsSummary.totalReviews || 0).toLocaleString() }, `${Number(reviewsSummary.totalReviews || 0).toLocaleString()} verified reviews`)}
                            </p>
                            <p className="mt-1 text-xs text-neo-cyan font-semibold">
                              {t('productPage.withProof', { count: Number(reviewsSummary.withMediaCount || 0).toLocaleString() }, `${Number(reviewsSummary.withMediaCount || 0).toLocaleString()} with photo/video proof`)}
                            </p>
                            <div className="mt-4 space-y-2">
                              {[5, 4, 3, 2, 1].map((score) => {
                                const count = Number(reviewsSummary.ratingBreakdown?.[score] || 0);
                                const percent = reviewsSummary.totalReviews > 0
                                  ? Math.round((count / reviewsSummary.totalReviews) * 100)
                                  : 0;
                                return (
                                  <div key={score} className={cn('flex items-center gap-3 text-xs', bodyTextClass)}>
                                    <span className="w-4 font-bold">{score}</span>
                                    <div className={cn('h-2 flex-1 rounded-full overflow-hidden', isStylishWhite ? 'bg-slate-200/80' : 'bg-white/10')}>
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

                          <div className={cn('lg:col-span-2 rounded-2xl border p-5', surfaceCardClass)}>
                            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                              <p className={cn('text-xs uppercase tracking-[0.16em] font-bold', mutedTextClass)}>{t('productPage.verifiedFeedback', {}, 'Verified Customer Feedback')}</p>
                              <PremiumSelect
                                value={reviewSort}
                                onChange={(e) => setReviewSort(e.target.value)}
                                className={cn('rounded-lg border px-3 py-2 text-xs font-bold uppercase tracking-[0.1em]', inputClass)}
                              >
                                <option value="newest">{t('productPage.sort.newest', {}, 'Newest')}</option>
                                <option value="top-rating">{t('productPage.sort.topRated', {}, 'Top Rated')}</option>
                                <option value="oldest">{t('productPage.sort.oldest', {}, 'Oldest')}</option>
                                <option value="helpful">{t('productPage.sort.mostHelpful', {}, 'Most Helpful')}</option>
                              </PremiumSelect>
                            </div>

                            {reviewsLoading ? (
                              <div className="space-y-3">
                                {[...Array(3)].map((_, idx) => (
                                  <div key={idx} className={cn('h-24 rounded-xl animate-pulse border', isStylishWhite ? 'border-slate-200/80 bg-slate-100/80' : 'bg-white/5 border-white/5')} />
                                ))}
                              </div>
                            ) : reviewsError ? (
                              <p className="text-sm text-rose-300">{translateProductText(reviewsError)}</p>
                            ) : reviewsData.length === 0 ? (
                              <div className={cn('rounded-xl border px-4 py-6 text-center', softPanelClass)}>
                                <MessageSquare className={cn('w-8 h-8 mx-auto mb-2', subtleTextClass)} />
                                <p className={cn('text-sm', bodyTextClass)}>{t('productPage.noVerifiedReviews', {}, 'No verified reviews yet for this product.')}</p>
                              </div>
                            ) : (
                              <div className="space-y-4 max-h-[480px] overflow-y-auto pr-1">
                                {reviewsData.map((review) => (
                                  <article key={review.id} className={cn('rounded-xl border p-4', softPanelClass)}>
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                      <div>
                                        <p className={cn('text-sm font-bold', strongTextClass)}>{review.user?.name || t('productPage.verifiedBuyer', {}, 'Verified Buyer')}</p>
                                        <p className={cn('text-[11px]', mutedTextClass)}>
                                          {formatDateTime(review.createdAt, undefined, { day: '2-digit', month: 'short', year: 'numeric' })}
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
                                            {t('productPage.verifiedPurchase', {}, 'Verified Purchase')}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    <p className={cn('mt-3 text-sm leading-relaxed', bodyTextClass)}>{translateProductText(review.comment)}</p>
                                    {Array.isArray(review.media) && review.media.length > 0 && (
                                      <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2">
                                        {review.media.map((asset, index) => (
                                          <div key={`${review.id}-media-${index}`} className={cn('rounded-lg overflow-hidden border', isStylishWhite ? 'border-slate-200/80 bg-slate-100/90' : 'border-white/10 bg-zinc-900/70')}>
                                            {asset.type === 'video' ? (
                                              <video src={asset.url} controls className="w-full h-24 object-cover" />
                                            ) : (
                                              <img src={asset.url} alt={translateProductText(asset.caption) || t('productPage.reviewMedia', {}, 'Review media')} className="w-full h-24 object-cover" />
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

                        <div className={cn('rounded-2xl border p-5', surfaceCardClass)}>
                          <p className={cn('text-xs uppercase tracking-[0.16em] font-bold mb-4', mutedTextClass)}>{t('productPage.postReview', {}, 'Post Your Verified Review')}</p>
                          {!currentUser && (
                            <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-100 mb-4">
                              {t('productPage.reviewLoginRequired', {}, 'Login is required to post a review. Only real customers with a valid purchase can submit feedback.')}
                            </div>
                          )}
                          {reviewSubmitMessage && (
                            <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3 text-sm text-emerald-100 mb-4">
                              {translateProductText(reviewSubmitMessage)}
                            </div>
                          )}
                          {reviewSubmitError && (
                            <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100 mb-4">
                              {translateProductText(reviewSubmitError)}
                            </div>
                          )}

                          <form onSubmit={handleSubmitReview} className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              <div>
                                <label className={cn('text-xs uppercase tracking-[0.12em] font-bold', mutedTextClass)}>{t('productPage.rating', {}, 'Rating')}</label>
                                <PremiumSelect
                                  value={reviewForm.rating}
                                  onChange={(e) => setReviewForm((prev) => ({ ...prev, rating: Number(e.target.value) }))}
                                  className={cn('mt-1 w-full rounded-lg border px-3 py-2 text-sm', inputClass)}
                                >
                                  <option value={5}>{t('productPage.rating.excellent', {}, '5 - Excellent')}</option>
                                  <option value={4}>{t('productPage.rating.good', {}, '4 - Good')}</option>
                                  <option value={3}>{t('productPage.rating.average', {}, '3 - Average')}</option>
                                  <option value={2}>{t('productPage.rating.poor', {}, '2 - Poor')}</option>
                                  <option value={1}>{t('productPage.rating.bad', {}, '1 - Bad')}</option>
                                </PremiumSelect>
                              </div>
                              <div className="md:col-span-2">
                                <label className={cn('text-xs uppercase tracking-[0.12em] font-bold', mutedTextClass)}>{t('productPage.comment', {}, 'Comment')}</label>
                                <textarea
                                  value={reviewForm.comment}
                                  onChange={(e) => setReviewForm((prev) => ({ ...prev, comment: e.target.value }))}
                                  placeholder={t('productPage.commentPlaceholder', {}, 'Share real usage experience, quality, delivery, and value details...')}
                                  rows={3}
                                  className={cn('mt-1 w-full rounded-lg border px-3 py-2 text-sm resize-none', inputClass)}
                                />
                              </div>
                            </div>

                            <div className={cn('rounded-xl border p-3', softPanelClass)}>
                              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                <p className={cn('text-xs uppercase tracking-[0.12em] font-bold', mutedTextClass)}>
                                  {t('productPage.proofMedia', {}, 'Add Proof Media (Direct Upload + URL)')}
                                </p>
                                <button
                                  type="button"
                                  onClick={handleOpenReviewFilePicker}
                                  disabled={reviewUploadInProgress}
                                  className="rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-bold text-emerald-200 hover:bg-emerald-500/25 inline-flex items-center gap-1.5 disabled:opacity-70"
                                >
                                  {reviewUploadInProgress ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
                                  {reviewUploadInProgress ? t('productPage.uploading', {}, 'Uploading...') : t('productPage.uploadFromDevice', {}, 'Upload From Device')}
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
                                <p className="mb-2 text-xs font-semibold text-emerald-200">{translateProductText(reviewUploadMessage)}</p>
                              )}
                              <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                                <PremiumSelect
                                  value={mediaDraft.type}
                                  onChange={(e) => setMediaDraft((prev) => ({ ...prev, type: e.target.value }))}
                                  className={cn('rounded-lg border px-3 py-2 text-sm', inputClass)}
                                >
                                  <option value="image">{t('productPage.image', {}, 'Image')}</option>
                                  <option value="video">{t('productPage.video', {}, 'Video')}</option>
                                </PremiumSelect>
                                <input
                                  type="text"
                                  value={mediaDraft.url}
                                  onChange={(e) => setMediaDraft((prev) => ({ ...prev, url: e.target.value }))}
                                  placeholder="https://..."
                                  className={cn('md:col-span-2 rounded-lg border px-3 py-2 text-sm', inputClass)}
                                />
                                <button
                                  type="button"
                                  onClick={handleAddReviewMedia}
                                  className="rounded-lg border border-neo-cyan/40 bg-neo-cyan/15 px-3 py-2 text-sm font-bold text-neo-cyan hover:bg-neo-cyan/25"
                                >
                                  {t('productPage.addMedia', {}, 'Add Media')}
                                </button>
                              </div>
                              <input
                                type="text"
                                value={mediaDraft.caption}
                                onChange={(e) => setMediaDraft((prev) => ({ ...prev, caption: e.target.value }))}
                                placeholder={t('productPage.optionalCaption', {}, 'Optional caption')}
                                className={cn('mt-2 w-full rounded-lg border px-3 py-2 text-sm', inputClass)}
                              />
                              {reviewForm.media.length > 0 && (
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {reviewForm.media.map((asset, index) => (
                                    <div key={`${asset.url}-${index}`} className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs', isStylishWhite ? 'border-slate-200/80 bg-white/92 text-slate-700' : 'border-white/15 bg-white/10 text-slate-200')}>
                                      {asset.type === 'video' ? <Video className="w-3.5 h-3.5 text-violet-300" /> : <ImageIcon className="w-3.5 h-3.5 text-neo-cyan" />}
                                      <span className="max-w-[180px] truncate">{asset.url}</span>
                                      <button type="button" onClick={() => handleRemoveReviewMedia(index)} className={cn(mutedTextClass, 'hover:text-rose-300')}>
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
                              {reviewSubmitting ? t('productPage.submitting', {}, 'Submitting...') : t('productPage.submitReview', {}, 'Submit Verified Review')}
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
          <SectionErrorBoundary label={t('productPage.similarItems', {}, 'Similar Items')}>
            <div className="mt-14 sm:mt-20">
              <div className="flex items-center gap-4 mb-8">
                <h2 className={cn('text-2xl font-black tracking-tight', strongTextClass)}>{t('productPage.similarItems', {}, 'Similar Items')}</h2>
                <div className="flex-1 h-px bg-gradient-to-r from-white/10 to-transparent" />
              </div>
              <div className="space-y-4 md:hidden">
                {translatedRelatedProducts.map((item) => (
                  <ProductCard
                    key={item.id || item._id}
                    product={item}
                    variant="list"
                  />
                ))}
              </div>
              <div className="hidden gap-6 md:grid md:grid-cols-2 xl:grid-cols-4">
                {translatedRelatedProducts.map((item) => (
                  <ProductCard
                    key={item.id || item._id}
                    product={item}
                  />
                ))}
              </div>
            </div>
          </SectionErrorBoundary>
        )}
      </div>
    </div>
  );
};

export default ProductDetails;

