function compact(value: string) {
  return value.toLowerCase().replace(/[\s·_.\-—/（）()]/gu, "");
}

export function allowedViralKeyword(keyword: string, productNames: string[]) {
  const normalized = compact(keyword);
  if (!normalized || /赛电|saydian/iu.test(normalized)) return false;

  return !productNames.some((name) => {
    const fullName = compact(name);
    const withoutBrand = fullName.replace(/赛电|saydian/giu, "");
    return (fullName.length >= 4 && normalized.includes(fullName))
      || (withoutBrand.length >= 4 && normalized.includes(withoutBrand));
  });
}
