-- REAL_DATA.md section 7, the size check: the median size of the sales a comparison used, so the
-- stored comparison can say how much larger or smaller the listing is than the typical sale.
ALTER TABLE "checks" ADD COLUMN "median_size_sqft" double precision;
