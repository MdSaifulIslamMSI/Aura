export const getPricingModel = (entity = {}) => {
  if (entity?.pricing && typeof entity.pricing === 'object') {
    return entity.pricing;
  }

  const displayCurrency = String(
    entity?.displayCurrency
      || entity?.presentmentCurrency
      || entity?.currency
      || entity?.market?.currency
      || 'INR'
  ).toUpperCase();

  const displayAmount = Number(
    entity?.displayAmount
      ?? entity?.presentmentTotalPrice
      ?? entity?.price
      ?? 0
  );

  const originalDisplayAmount = Number(
    entity?.originalDisplayAmount
      ?? entity?.originalPrice
      ?? displayAmount
  );

  return {
    baseAmount: Number(entity?.baseAmount ?? entity?.price ?? displayAmount ?? 0),
    baseCurrency: String(entity?.baseCurrency || entity?.settlementCurrency || displayCurrency).toUpperCase(),
    displayAmount,
    displayCurrency,
    originalDisplayAmount,
    originalBaseAmount: Number(entity?.originalBaseAmount ?? entity?.originalPrice ?? originalDisplayAmount ?? displayAmount ?? 0),
    formattedPrice: '',
    formattedOriginalPrice: '',
    fallbackApplied: false,
    fallbackMessage: '',
  };
};

export const getDisplayAmount = (entity = {}) => Number(getPricingModel(entity).displayAmount || 0);
export const getDisplayCurrency = (entity = {}) => getPricingModel(entity).displayCurrency || 'INR';
export const getOriginalDisplayAmount = (entity = {}) => Number(getPricingModel(entity).originalDisplayAmount || getDisplayAmount(entity));
export const getBaseAmount = (entity = {}) => Number(getPricingModel(entity).baseAmount || 0);
export const getBaseCurrency = (entity = {}) => getPricingModel(entity).baseCurrency || 'INR';
export const getOriginalBaseAmount = (entity = {}) => Number(getPricingModel(entity).originalBaseAmount || getBaseAmount(entity));

export const getLineDisplayTotal = (entity = {}) => {
  const quantity = Math.max(1, Number(entity?.quantity || 1));
  return getDisplayAmount(entity) * quantity;
};
