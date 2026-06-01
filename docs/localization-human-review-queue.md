# Localization Human Review Queue

Date: 2026-06-01

Machine assistance is not treated as native-speaker review. These entries are
reviewed enough for engineering QA and layout smoke, but they still need native
language review before being considered final marketplace copy.

| Message ID | English source | Hindi current | Bengali current | Urdu current | Arabic current | Context | Risk | Suggested better copy | Native review |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `checkout.action.placeOrder` | Place order | ऑर्डर दें | অর্ডার দিন | آرڈر دیں | قدّم الطلب | Final checkout submit button | High | Confirm tone is natural for paid ecommerce checkout. | Yes |
| `checkout.status.paymentFailed` | Payment failed | भुगतान विफल | পেমেন্ট ব্যর্থ | ادائیگی ناکام | فشل الدفع | Payment state badge/detail | High | Confirm local payment terminology and severity. | Yes |
| `checkout.status.paymentPending` | Payment pending | भुगतान लंबित | পেমেন্ট অপেক্ষায় | ادائیگی زیر التوا | الدفع قيد الانتظار | Payment state badge/detail | High | Confirm concise status wording for small badges. | Yes |
| `checkout.status.paymentSuccess` | Payment successful | भुगतान सफल | পেমেন্ট সফল | ادائیگی کامیاب | تم الدفع بنجاح | Payment state badge/detail | High | Confirm whether successful/authorized distinction should differ by rail. | Yes |
| `cart.action.addToCart` | Add to cart | कार्ट में जोड़ें | কার্টে যোগ করুন | کارٹ میں شامل کریں | أضف إلى السلة | Product action button | High | Confirm regional preference for cart/bag wording. | Yes |
| `cart.action.removeFromCart` | Remove from cart | कार्ट से हटाएं | কার্ট থেকে সরান | کارٹ سے ہٹائیں | إزالة من السلة | Cart row action | High | Confirm polite imperative and compact fit. | Yes |
| `cart.status.empty` | Your cart is empty | आपका कार्ट खाली है | আপনার কার্ট খালি | آپ کا کارٹ خالی ہے | سلتك فارغة | Cart empty state | High | Confirm cart/bag terminology alignment. | Yes |
| `auth.action.signIn` | Sign in | साइन इन करें | সাইন ইন করুন | سائن ان کریں | تسجيل الدخول | Auth CTA | High | Confirm whether transliteration or local phrase is preferred. | Yes |
| `auth.action.signUp` | Sign up | साइन अप करें | সাইন আপ করুন | سائن اپ کریں | إنشاء حساب | Auth CTA | High | Confirm account-creation wording. | Yes |
| `auth.security.passwordVisible` | Hide password | पासवर्ड छिपाएं | পাসওয়ার্ড লুকান | پاس ورڈ چھپائیں | إخفاء كلمة المرور | Password visibility control | High | Confirm screen-reader clarity. | Yes |
| `auth.security.passwordHidden` | Show password | पासवर्ड दिखाएं | পাসওয়ার্ড দেখান | پاس ورڈ دکھائیں | إظهار كلمة المرور | Password visibility control | High | Confirm screen-reader clarity. | Yes |
| `payment.error.generic` | Payment could not be completed. Please try again. | भुगतान पूरा नहीं हुआ। फिर कोशिश करें। | পেমেন্ট সম্পন্ন হয়নি। আবার চেষ্টা করুন। | ادائیگی مکمل نہ ہو سکی۔ دوبارہ کوشش کریں۔ | تعذر إكمال الدفع. حاول مرة أخرى. | Payment error fallback | High | Confirm recovery language is clear without blaming user. | Yes |
| `payment.error.retry` | Retry payment | भुगतान फिर करें | পেমেন্ট আবার চেষ্টা করুন | ادائیگی دوبارہ کریں | أعد محاولة الدفع | Payment retry action | High | Confirm compact action label. | Yes |
| `order.status.confirmed` | Order confirmed | ऑर्डर पक्का हुआ | অর্ডার নিশ্চিত হয়েছে | آرڈر کی تصدیق ہو گئی | تم تأكيد الطلب | Order status | High | Confirm confirmed vs accepted wording. | Yes |

## Flow Priorities

- Checkout and payment copy: highest risk because it affects money movement and recovery.
- Auth and account-security copy: highest risk because misunderstanding can lock users out.
- Order, refund, support, and seller dashboard copy: high risk because it affects post-purchase trust.
- Navigation and product browsing copy: medium risk once transaction flows are stable.
