-- Calibration belongs to the SCREEN, not the campaign.
--
-- px-per-inch is a fact about a particular piece of glass: it survives
-- being reassigned from table to board, it should follow the screen when
-- you point it at a different campaign, and two table screens in one
-- room have two different answers. Storing it on the campaign could only
-- ever be right for one screen at a time.
--
-- The reported viewport moves with it for the same reason — it's what
-- that screen is, not what the campaign is.

ALTER TABLE displays ADD COLUMN ppi REAL;
ALTER TABLE displays ADD COLUMN ppi_y REAL;
ALTER TABLE displays ADD COLUMN vw INTEGER;
ALTER TABLE displays ADD COLUMN vh INTEGER;
