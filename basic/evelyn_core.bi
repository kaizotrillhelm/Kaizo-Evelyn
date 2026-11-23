' evelyn_core.bi - Evelyn and her Echoes, BASIC edition (FreeBASIC -lang qb).
'
' Same behaviour as js/evelyn_core.js for: text helpers, LZW library with base64,
' TNY2 neural engine (greedy answers), learner profile (USER.CFG), coding sandbox,
' adventure and tutor. Left out of this edition: KV21 export/import, sampling with a
' seed, multi-shelf deliberation and the packet codecs (see README.md).
'
' Style rules that keep the file safe for 16-bit INTEGER and exact in the neural net:
'   - an index that can pass 32767 is LONG, and one operand of the product is CLNG
'   - every sum or product over SINGLE data goes through CDBL, so it is done in DOUBLE
'   - float literals carry a # suffix
' All tables are sized by the CONSTs below; a model larger than they allow is refused.

CONST VOCAB = 97
CONST CTX = 128
CONST MAXD = 96&
CONST MAXL = 4
CONST MAXHID = 256
CONST LIBMAX = 1000
CONST LZMAX = 4095

' ---------------------------------------------------------------- state: model
DIM SHARED gTD AS INTEGER, gTL AS INTEGER, gTH AS INTEGER, gHD AS INTEGER, gHID AS INTEGER
DIM SHARED gAttDiv AS DOUBLE, gNetLoaded AS INTEGER, gKvPrefix AS INTEGER
DIM SHARED gRngHi AS LONG, gRngLo AS LONG
DIM SHARED aEmbW(VOCAB * MAXD) AS INTEGER, aEmbS(VOCAB) AS SINGLE
DIM SHARED aPosW(CTX * MAXD) AS INTEGER, aPosS(CTX) AS SINGLE
DIM SHARED aG1(MAXL * MAXD) AS SINGLE, aG2(MAXL * MAXD) AS SINGLE, aGf(MAXD) AS SINGLE
DIM SHARED aWqW(MAXL * MAXD * MAXD) AS INTEGER, aWqS(MAXL * MAXD) AS SINGLE
DIM SHARED aWkW(MAXL * MAXD * MAXD) AS INTEGER, aWkS(MAXL * MAXD) AS SINGLE
DIM SHARED aWvW(MAXL * MAXD * MAXD) AS INTEGER, aWvS(MAXL * MAXD) AS SINGLE
DIM SHARED aWoW(MAXL * MAXD * MAXD) AS INTEGER, aWoS(MAXL * MAXD) AS SINGLE
DIM SHARED aF1W(MAXL * MAXHID * MAXD) AS INTEGER, aF1S(MAXL * MAXHID) AS SINGLE
DIM SHARED aF2W(MAXL * MAXD * MAXHID) AS INTEGER, aF2S(MAXL * MAXD) AS SINGLE
DIM SHARED aKc(MAXL * CTX * MAXD) AS INTEGER, aKs(MAXL * CTX) AS SINGLE
DIM SHARED aVc(MAXL * CTX * MAXD) AS INTEGER, aVs(MAXL * CTX) AS SINGLE
DIM SHARED aBx(MAXD) AS SINGLE, aBh(MAXD) AS SINGLE, aBq(MAXD) AS SINGLE
DIM SHARED aBt(MAXD) AS SINGLE, aBa(MAXD) AS SINGLE, aBm(MAXHID) AS SINGLE
DIM SHARED aBsc(CTX) AS SINGLE, aScore(VOCAB) AS SINGLE

' ---------------------------------------------------------------- state: text work
DIM SHARED gWordN AS INTEGER, aWord(255) AS STRING
DIM SHARED aLzKey(8191) AS LONG, aLzVal(8191) AS INTEGER
DIM SHARED aLzPre(4095) AS INTEGER, aLzChr(4095) AS INTEGER, aLzFirst(4095) AS INTEGER, aLzLen(4095) AS INTEGER
DIM SHARED gLzErr AS INTEGER

' ---------------------------------------------------------------- state: library
DIM SHARED gLibN AS INTEGER
DIM SHARED aLibTopic(LIBMAX) AS STRING, aLibTopicLc(LIBMAX) AS STRING, aLibCat(LIBMAX) AS STRING
DIM SHARED aLibZFact(LIBMAX) AS STRING, aLibZEx(LIBMAX) AS STRING, aLibWords(LIBMAX) AS STRING
DIM SHARED aHit(19) AS INTEGER, aScoreL(LIBMAX) AS INTEGER, aTaken(LIBMAX) AS INTEGER
DIM SHARED gRdFact AS STRING, gRdEx AS STRING

' ---------------------------------------------------------------- state: profile
DIM SHARED gPmName AS STRING, gPmMode AS STRING, gPmPace AS STRING, gPmRoom AS STRING
DIM SHARED gPmXp AS LONG, aPmFb(3) AS LONG
DIM SHARED aPmSolved(15) AS STRING, gPmSolvedN AS INTEGER
DIM SHARED aPmInv(15) AS STRING, gPmInvN AS INTEGER
DIM SHARED aPmMastered(63) AS STRING, gPmMasteredN AS INTEGER
DIM SHARED aPmRecent(20) AS STRING, gPmRecentN AS INTEGER
DIM SHARED gLastSpoken AS STRING

' ---------------------------------------------------------------- state: sandbox
DIM SHARED aTk(255) AS STRING, gTkN AS INTEGER, gTkPos AS INTEGER
DIM SHARED gRIsStr AS INTEGER, gRNum AS DOUBLE, gRStr AS STRING
DIM SHARED gVN AS INTEGER, aVName(63) AS STRING, aVIsStr(63) AS INTEGER, aVNum(63) AS DOUBLE, aVStr(63) AS STRING
DIM SHARED gRunOk AS INTEGER, gRunErr AS STRING, gOutN AS INTEGER, aOut(599) AS STRING, gGrid AS STRING
DIM SHARED aLn(399) AS STRING, aJump(399) AS INTEGER, aCount(399) AS DOUBLE

' ---------------------------------------------------------------- state: adventure and tutor
DIM SHARED rmId(4) AS STRING, rmTitle(4) AS STRING, rmDesc(4) AS STRING, rmNEx(4) AS INTEGER
DIM SHARED rmExDir(4, 2) AS STRING, rmExRoom(4, 2) AS STRING
DIM SHARED rmPid(4) AS STRING, rmPrompt(4) AS STRING, rmNKw(4) AS INTEGER, rmKw(4, 3) AS STRING
DIM SHARED rmHint(4) AS STRING, rmReward(4) AS STRING, rmXp(4) AS INTEGER
DIM SHARED gTutSource AS STRING

CONST B64CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
CONST STOPWORDS = " a an the is are was were of in on to for and or it its what which who where when how do does did can you me tell about "

' ================================================================ small helpers
FUNCTION IsDigit% (iC AS INTEGER)
    IF iC >= 48 AND iC <= 57 THEN IsDigit% = -1 ELSE IsDigit% = 0
END FUNCTION

FUNCTION IsAlpha% (iC AS INTEGER)
    IF (iC >= 65 AND iC <= 90) OR (iC >= 97 AND iC <= 122) THEN IsAlpha% = -1 ELSE IsAlpha% = 0
END FUNCTION

FUNCTION IsAlnum% (iC AS INTEGER)
    IF IsDigit%(iC) OR IsAlpha%(iC) THEN IsAlnum% = -1 ELSE IsAlnum% = 0
END FUNCTION

FUNCTION IsWs% (iC AS INTEGER)
    IF iC = 32 OR iC = 9 OR iC = 10 OR iC = 13 THEN IsWs% = -1 ELSE IsWs% = 0
END FUNCTION

FUNCTION TrimWs$ (sSrc AS STRING)
    DIM iA AS LONG, iB AS LONG
    iA = 1
    iB = LEN(sSrc)
    DO WHILE iA <= iB
        IF IsWs%(ASC(MID$(sSrc, iA, 1))) = 0 THEN EXIT DO
        iA = iA + 1
    LOOP
    DO WHILE iB >= iA
        IF IsWs%(ASC(MID$(sSrc, iB, 1))) = 0 THEN EXIT DO
        iB = iB - 1
    LOOP
    TrimWs$ = MID$(sSrc, iA, iB - iA + 1)
END FUNCTION

FUNCTION TrimSp$ (sSrc AS STRING)
    DIM iA AS LONG, iB AS LONG
    iA = 1
    iB = LEN(sSrc)
    DO WHILE iA <= iB
        IF MID$(sSrc, iA, 1) <> " " THEN EXIT DO
        iA = iA + 1
    LOOP
    DO WHILE iB >= iA
        IF MID$(sSrc, iB, 1) <> " " THEN EXIT DO
        iB = iB - 1
    LOOP
    TrimSp$ = MID$(sSrc, iA, iB - iA + 1)
END FUNCTION

FUNCTION IntStr$ (lV AS LONG)
    IntStr$ = LTRIM$(STR$(lV))
END FUNCTION

' ================================================================ numbers
' digits of a whole number below 1E15
FUNCTION FmtInt$ (dIn AS DOUBLE)
    DIM dX AS DOUBLE, dQ AS DOUBLE, dD AS DOUBLE, sR AS STRING
    dX = dIn
    IF dX < 1# THEN
        FmtInt$ = "0"
        EXIT FUNCTION
    END IF
    sR = ""
    DO WHILE dX >= 1#
        dQ = INT(dX / 10#)
        dD = dX - dQ * 10#
        sR = CHR$(48 + CINT(dD)) + sR
        dX = dQ
    LOOP
    FmtInt$ = sR
END FUNCTION

' whole numbers print whole; others print up to six decimals without trailing zeros
FUNCTION FmtNum$ (dIn AS DOUBLE)
    DIM dA AS DOUBLE, iNeg AS INTEGER, sR AS STRING, dS AS DOUBLE, dIp AS DOUBLE, dFp AS DOUBLE, sF AS STRING
    dA = dIn
    iNeg = 0
    IF dA < 0# THEN
        iNeg = -1
        dA = -dA
    END IF
    IF dA = INT(dA) AND dA < 1D15 THEN
        sR = FmtInt$(dA)
    ELSE
        dS = INT(dA * 1000000# + 0.5#)
        dIp = INT(dS / 1000000#)
        dFp = dS - dIp * 1000000#
        sR = FmtInt$(dIp)
        IF dFp > 0# THEN
            sF = FmtInt$(dFp)
            sF = STRING$(6 - LEN(sF), "0") + sF
            DO WHILE RIGHT$(sF, 1) = "0"
                sF = LEFT$(sF, LEN(sF) - 1)
            LOOP
            sR = sR + "." + sF
        END IF
    END IF
    IF sR = "0" THEN
        FmtNum$ = "0"
    ELSEIF iNeg THEN
        FmtNum$ = "-" + sR
    ELSE
        FmtNum$ = sR
    END IF
END FUNCTION

' spaces, sign, digits with a fraction; the rest is ignored
FUNCTION ValOf# (sSrc AS STRING)
    DIM iP AS INTEGER, iN AS INTEGER, iNeg AS INTEGER, dN AS DOUBLE, dScale AS DOUBLE, iDig AS INTEGER, iC AS INTEGER
    iN = LEN(sSrc)
    iP = 1
    DO WHILE iP <= iN
        IF MID$(sSrc, iP, 1) <> " " THEN EXIT DO
        iP = iP + 1
    LOOP
    iNeg = 0
    IF iP <= iN THEN
        IF MID$(sSrc, iP, 1) = "-" THEN
            iNeg = -1
            iP = iP + 1
        ELSEIF MID$(sSrc, iP, 1) = "+" THEN
            iP = iP + 1
        END IF
    END IF
    dN = 0#
    dScale = 1#
    iDig = 0
    DO WHILE iP <= iN
        iC = ASC(MID$(sSrc, iP, 1))
        IF IsDigit%(iC) = 0 THEN EXIT DO
        dN = dN * 10# + (iC - 48)
        iDig = iDig + 1
        iP = iP + 1
    LOOP
    IF iP < iN THEN
        IF MID$(sSrc, iP, 1) = "." AND IsDigit%(ASC(MID$(sSrc, iP + 1, 1))) THEN
            iP = iP + 1
            DO WHILE iP <= iN
                iC = ASC(MID$(sSrc, iP, 1))
                IF IsDigit%(iC) = 0 THEN EXIT DO
                dN = dN * 10# + (iC - 48)
                dScale = dScale * 10#
                iDig = iDig + 1
                iP = iP + 1
            LOOP
        END IF
    END IF
    IF iDig = 0 THEN
        ValOf# = 0#
    ELSEIF iNeg THEN
        ValOf# = -(dN / dScale)
    ELSE
        ValOf# = dN / dScale
    END IF
END FUNCTION

' ================================================================ text
' keeps printable ASCII and newlines, maps curly quotes and dashes, turns anything else into a space,
' squeezes runs of spaces and trims spaces and newlines at both ends
FUNCTION CleanAscii$ (sSrc AS STRING)
    DIM sTmp AS STRING, sOut AS STRING, iP AS LONG, iN AS LONG, iC AS INTEGER, iD AS INTEGER, iLast AS INTEGER
    DIM iA AS LONG, iB AS LONG, sCh AS STRING
    iN = LEN(sSrc)
    iP = 1
    sTmp = ""
    DO WHILE iP <= iN
        iC = ASC(MID$(sSrc, iP, 1))
        IF iC >= 32 AND iC <= 126 THEN
            sTmp = sTmp + CHR$(iC)
            iP = iP + 1
        ELSEIF iC = 10 THEN
            sTmp = sTmp + CHR$(10)
            iP = iP + 1
        ELSEIF iC = 226 AND iP + 2 <= iN THEN
            iD = ASC(MID$(sSrc, iP + 2, 1))
            IF ASC(MID$(sSrc, iP + 1, 1)) = 128 AND (iD = 152 OR iD = 153) THEN
                sTmp = sTmp + "'"
                iP = iP + 3
            ELSEIF ASC(MID$(sSrc, iP + 1, 1)) = 128 AND (iD = 156 OR iD = 157) THEN
                sTmp = sTmp + CHR$(34)
                iP = iP + 3
            ELSEIF ASC(MID$(sSrc, iP + 1, 1)) = 128 AND (iD = 147 OR iD = 148) THEN
                sTmp = sTmp + "-"
                iP = iP + 3
            ELSE
                sTmp = sTmp + " "
                iP = iP + 1
            END IF
        ELSE
            sTmp = sTmp + " "
            iP = iP + 1
        END IF
    LOOP
    sOut = ""
    iLast = 0
    FOR iP = 1 TO LEN(sTmp)
        sCh = MID$(sTmp, iP, 1)
        IF sCh = " " AND iLast = 32 THEN
            ' second space of a run: skip
        ELSE
            sOut = sOut + sCh
            iLast = ASC(sCh)
        END IF
    NEXT iP
    iA = 1
    iB = LEN(sOut)
    DO WHILE iA <= iB
        sCh = MID$(sOut, iA, 1)
        IF sCh <> " " AND sCh <> CHR$(10) THEN EXIT DO
        iA = iA + 1
    LOOP
    DO WHILE iB >= iA
        sCh = MID$(sOut, iB, 1)
        IF sCh <> " " AND sCh <> CHR$(10) THEN EXIT DO
        iB = iB - 1
    LOOP
    CleanAscii$ = MID$(sOut, iA, iB - iA + 1)
END FUNCTION

' lower-case words of letters and digits, without stop words, into aWord()
SUB Tokenize (sText AS STRING)
    DIM iP AS INTEGER, iN AS INTEGER, iSt AS INTEGER, sW AS STRING
    gWordN = 0
    iN = LEN(sText)
    iP = 1
    DO WHILE iP <= iN
        IF IsAlnum%(ASC(MID$(sText, iP, 1))) THEN
            iSt = iP
            DO WHILE iP <= iN
                IF IsAlnum%(ASC(MID$(sText, iP, 1))) = 0 THEN EXIT DO
                iP = iP + 1
            LOOP
            sW = LCASE$(MID$(sText, iSt, iP - iSt))
            IF INSTR(STOPWORDS, " " + sW + " ") = 0 AND gWordN < 256 THEN
                aWord(gWordN) = sW
                gWordN = gWordN + 1
            END IF
        ELSE
            iP = iP + 1
        END IF
    LOOP
END SUB

' ================================================================ LZW (16-bit codes) and base64
' returns the compressed bytes as a string, two bytes per code, low byte first
FUNCTION LzCompress$ (sSrc AS STRING)
    DIM lKey AS LONG, lH AS LONG, lW AS LONG, lNext AS LONG, lP AS LONG, iC AS INTEGER, sOut AS STRING, iFound AS INTEGER
    DIM iK AS INTEGER
    IF LEN(sSrc) = 0 THEN
        LzCompress$ = ""
        EXIT FUNCTION
    END IF
    FOR iK = 0 TO 8191
        aLzKey(iK) = -1
    NEXT iK
    sOut = ""
    lNext = 256
    lW = -1
    FOR lP = 1 TO LEN(sSrc)
        iC = ASC(MID$(sSrc, lP, 1))
        IF lW < 0 THEN
            lW = iC
        ELSE
            lKey = lW * 256 + iC
            lH = (lKey * 31) MOD 8191
            iFound = 0
            DO
                IF aLzKey(lH) = -1 THEN EXIT DO
                IF aLzKey(lH) = lKey THEN
                    iFound = -1
                    EXIT DO
                END IF
                lH = lH + 1
                IF lH > 8191 THEN lH = 0
            LOOP
            IF iFound THEN
                lW = aLzVal(lH)
            ELSE
                sOut = sOut + CHR$(lW AND 255) + CHR$((lW \ 256) AND 255)
                IF lNext < LZMAX THEN
                    aLzKey(lH) = lKey
                    aLzVal(lH) = lNext
                    lNext = lNext + 1
                END IF
                lW = iC
            END IF
        END IF
    NEXT lP
    sOut = sOut + CHR$(lW AND 255) + CHR$((lW \ 256) AND 255)
    LzCompress$ = sOut
END FUNCTION

' text of one dictionary code
FUNCTION LzExpand$ (iCode AS INTEGER)
    DIM sR AS STRING, iC AS INTEGER
    sR = ""
    iC = iCode
    DO WHILE iC >= 256
        sR = CHR$(aLzChr(iC)) + sR
        iC = aLzPre(iC)
    LOOP
    LzExpand$ = CHR$(iC) + sR
END FUNCTION

' sets gLzErr to -1 on a damaged stream (and returns "")
FUNCTION LzDecompress$ (sSrc AS STRING)
    DIM lN AS LONG, lI AS LONG, iK AS INTEGER, iW AS INTEGER, iNext AS INTEGER, iFirst AS INTEGER, sOut AS STRING
    DIM lK AS LONG, iX AS INTEGER
    gLzErr = 0
    lN = LEN(sSrc)
    IF lN = 0 THEN
        LzDecompress$ = ""
        EXIT FUNCTION
    END IF
    IF lN MOD 2 <> 0 THEN
        gLzErr = -1
        LzDecompress$ = ""
        EXIT FUNCTION
    END IF
    FOR iX = 0 TO 255
        aLzFirst(iX) = iX
        aLzLen(iX) = 1
    NEXT iX
    lK = ASC(MID$(sSrc, 1, 1)) + 256& * ASC(MID$(sSrc, 2, 1))
    IF lK > 255 THEN
        gLzErr = -1
        LzDecompress$ = ""
        EXIT FUNCTION
    END IF
    iW = lK
    sOut = CHR$(iW)
    iNext = 256
    FOR lI = 1 TO lN \ 2 - 1
        lK = ASC(MID$(sSrc, lI * 2 + 1, 1)) + 256& * ASC(MID$(sSrc, lI * 2 + 2, 1))
        IF lK < iNext THEN
            iK = lK
            sOut = sOut + LzExpand$(iK)
            iFirst = aLzFirst(iK)
        ELSEIF lK = iNext AND iNext < LZMAX THEN
            iK = lK
            iFirst = aLzFirst(iW)
            sOut = sOut + LzExpand$(iW) + CHR$(iFirst)
        ELSE
            gLzErr = -1
            LzDecompress$ = ""
            EXIT FUNCTION
        END IF
        IF iNext < LZMAX THEN
            aLzPre(iNext) = iW
            aLzChr(iNext) = iFirst
            aLzFirst(iNext) = aLzFirst(iW)
            aLzLen(iNext) = aLzLen(iW) + 1
            iNext = iNext + 1
        END IF
        iW = iK
    NEXT lI
    LzDecompress$ = sOut
END FUNCTION

FUNCTION Base64Enc$ (sBytes AS STRING)
    DIM iI AS LONG, iN AS LONG, lB0 AS LONG, lB1 AS LONG, lB2 AS LONG, lTrip AS LONG, sOut AS STRING
    iN = LEN(sBytes)
    sOut = ""
    iI = 1
    DO WHILE iI <= iN
        lB0 = ASC(MID$(sBytes, iI, 1))
        lB1 = 0
        lB2 = 0
        IF iI + 1 <= iN THEN lB1 = ASC(MID$(sBytes, iI + 1, 1))
        IF iI + 2 <= iN THEN lB2 = ASC(MID$(sBytes, iI + 2, 1))
        lTrip = lB0 * 65536 + lB1 * 256 + lB2
        sOut = sOut + MID$(B64CHARS, ((lTrip \ 262144) AND 63) + 1, 1)
        sOut = sOut + MID$(B64CHARS, ((lTrip \ 4096) AND 63) + 1, 1)
        IF iI + 1 <= iN THEN sOut = sOut + MID$(B64CHARS, ((lTrip \ 64) AND 63) + 1, 1) ELSE sOut = sOut + "="
        IF iI + 2 <= iN THEN sOut = sOut + MID$(B64CHARS, (lTrip AND 63) + 1, 1) ELSE sOut = sOut + "="
        iI = iI + 3
    LOOP
    Base64Enc$ = sOut
END FUNCTION

FUNCTION B64Val% (sCh AS STRING)
    DIM iV AS INTEGER
    iV = INSTR(B64CHARS, sCh) - 1
    IF iV < 0 THEN iV = 0
    B64Val% = iV
END FUNCTION

FUNCTION Base64Dec$ (sSrc AS STRING)
    DIM iN AS LONG, iI AS LONG, lC0 AS LONG, lC1 AS LONG, lC2 AS LONG, lC3 AS LONG, lTrip AS LONG, sOut AS STRING
    iN = LEN(sSrc)
    DO WHILE iN > 0
        IF MID$(sSrc, iN, 1) <> "=" THEN EXIT DO
        iN = iN - 1
    LOOP
    sOut = ""
    iI = 1
    DO WHILE iI <= iN
        lC0 = B64Val%(MID$(sSrc, iI, 1))
        lC1 = 0
        lC2 = 0
        lC3 = 0
        IF iI + 1 <= iN THEN lC1 = B64Val%(MID$(sSrc, iI + 1, 1))
        IF iI + 2 <= iN THEN lC2 = B64Val%(MID$(sSrc, iI + 2, 1))
        IF iI + 3 <= iN THEN lC3 = B64Val%(MID$(sSrc, iI + 3, 1))
        lTrip = lC0 * 262144 + lC1 * 4096 + lC2 * 64 + lC3
        sOut = sOut + CHR$((lTrip \ 65536) AND 255)
        IF iI + 2 <= iN THEN sOut = sOut + CHR$((lTrip \ 256) AND 255)
        IF iI + 3 <= iN THEN sOut = sOut + CHR$(lTrip AND 255)
        iI = iI + 4
    LOOP
    Base64Dec$ = sOut
END FUNCTION

' compressed and base64 text of a cleaned string; "" stays ""
FUNCTION PackText$ (sClean AS STRING)
    IF LEN(sClean) = 0 THEN
        PackText$ = ""
    ELSE
        PackText$ = Base64Enc$(LzCompress$(sClean))
    END IF
END FUNCTION

FUNCTION UnpackText$ (sPacked AS STRING)
    IF LEN(sPacked) = 0 THEN
        UnpackText$ = ""
    ELSE
        UnpackText$ = LzDecompress$(Base64Dec$(sPacked))
    END IF
END FUNCTION

' ================================================================ library
SUB LibClear
    gLibN = 0
END SUB

' " word word " for every distinct word of topic + fact
FUNCTION WordSet$ (sTopic AS STRING, sFact AS STRING)
    DIM sSet AS STRING, iI AS INTEGER
    Tokenize sTopic + " " + sFact
    sSet = " "
    FOR iI = 0 TO gWordN - 1
        IF INSTR(sSet, " " + aWord(iI) + " ") = 0 THEN sSet = sSet + aWord(iI) + " "
    NEXT iI
    WordSet$ = sSet
END FUNCTION

' returns the new entry's id, or -1 when the library is full
FUNCTION LibAdd% (sTopic AS STRING, sCat AS STRING, sFact AS STRING, sEx AS STRING)
    DIM sT AS STRING, sC AS STRING, sF AS STRING, sE AS STRING, iId AS INTEGER
    IF gLibN >= LIBMAX THEN
        LibAdd% = -1
        EXIT FUNCTION
    END IF
    sT = CleanAscii$(sTopic)
    IF LEN(sCat) = 0 THEN sC = CleanAscii$("general") ELSE sC = CleanAscii$(sCat)
    sF = CleanAscii$(sFact)
    sE = CleanAscii$(sEx)
    iId = gLibN
    aLibTopic(iId) = sT
    aLibTopicLc(iId) = LCASE$(sT)
    aLibCat(iId) = sC
    aLibZFact(iId) = PackText$(sF)
    aLibZEx(iId) = PackText$(sE)
    aLibWords(iId) = WordSet$(sT, sF)
    gLibN = gLibN + 1
    LibAdd% = iId
END FUNCTION

' topK best entries into aHit(); returns how many were found (at most 20)
FUNCTION LibSearch% (sQuery AS STRING, iTopK AS INTEGER)
    DIM iI AS INTEGER, iJ AS INTEGER, iK AS INTEGER, iBest AS INTEGER, iFound AS INTEGER, iWords AS INTEGER, iKk AS INTEGER
    DIM aQ(255) AS STRING
    iKk = iTopK
    IF iKk < 1 THEN iKk = 2
    IF iKk > 20 THEN iKk = 20
    Tokenize sQuery
    iWords = gWordN
    FOR iI = 0 TO iWords - 1
        aQ(iI) = aWord(iI)
    NEXT iI
    FOR iI = 0 TO gLibN - 1
        aScoreL(iI) = 0
        aTaken(iI) = 0
    NEXT iI
    FOR iJ = 0 TO iWords - 1
        FOR iI = 0 TO gLibN - 1
            IF INSTR(aLibWords(iI), " " + aQ(iJ) + " ") > 0 THEN
                IF INSTR(aLibTopicLc(iI), aQ(iJ)) > 0 THEN
                    aScoreL(iI) = aScoreL(iI) + 3
                ELSE
                    aScoreL(iI) = aScoreL(iI) + 1
                END IF
            END IF
        NEXT iI
    NEXT iJ
    iFound = 0
    FOR iK = 1 TO iKk
        iBest = -1
        FOR iI = 0 TO gLibN - 1
            IF aScoreL(iI) > 0 AND aTaken(iI) = 0 THEN
                IF iBest < 0 THEN
                    iBest = iI
                ELSEIF aScoreL(iI) > aScoreL(iBest) THEN
                    iBest = iI
                END IF
            END IF
        NEXT iI
        IF iBest < 0 THEN EXIT FOR
        aTaken(iBest) = -1
        aHit(iFound) = iBest
        iFound = iFound + 1
    NEXT iK
    LibSearch% = iFound
END FUNCTION

' unpacks entry iId into gRdFact and gRdEx
SUB LibRead (iId AS INTEGER)
    gRdFact = UnpackText$(aLibZFact(iId))
    gRdEx = UnpackText$(aLibZEx(iId))
END SUB

SUB LibStats (lEntries AS LONG, lChars AS LONG)
    DIM iI AS INTEGER
    lEntries = gLibN
    lChars = 0
    FOR iI = 0 TO gLibN - 1
        lChars = lChars + LEN(aLibZFact(iI)) + LEN(aLibZEx(iI))
    NEXT iI
END SUB

' one paragraph of the ingest: chunks of up to 170 characters every 140
FUNCTION IngestParagraph% (sPara AS STRING, sLabel AS STRING)
    DIM sP AS STRING, iI AS LONG, iN AS LONG, iOff AS LONG, iEnd AS LONG, sTopic AS STRING, iWords AS INTEGER
    DIM iSt AS LONG, sChunk AS STRING, iCount AS INTEGER, iDid AS INTEGER
    sP = ""
    iN = LEN(sPara)
    iI = 1
    DO WHILE iI <= iN
        IF MID$(sPara, iI, 1) = CHR$(10) THEN
            DO WHILE iI <= iN
                IF MID$(sPara, iI, 1) <> CHR$(10) THEN EXIT DO
                iI = iI + 1
            LOOP
            sP = sP + " "
        ELSE
            sP = sP + MID$(sPara, iI, 1)
            iI = iI + 1
        END IF
    LOOP
    sP = TrimSp$(sP)
    iN = LEN(sP)
    IF iN < 25 THEN
        IngestParagraph% = 0
        EXIT FUNCTION
    END IF
    sTopic = ""
    iWords = 0
    iI = 1
    DO WHILE iI <= iN AND iWords < 3
        DO WHILE iI <= iN
            IF MID$(sP, iI, 1) <> " " THEN EXIT DO
            iI = iI + 1
        LOOP
        iSt = iI
        DO WHILE iI <= iN
            IF MID$(sP, iI, 1) = " " THEN EXIT DO
            iI = iI + 1
        LOOP
        IF iI > iSt THEN
            IF iWords > 0 THEN sTopic = sTopic + " "
            sTopic = sTopic + MID$(sP, iSt, iI - iSt)
            iWords = iWords + 1
        END IF
    LOOP
    iCount = 0
    iOff = 0
    DO WHILE iOff < iN
        iEnd = iOff + 170
        IF iEnd > iN THEN iEnd = iN
        sChunk = TrimSp$(MID$(sP, iOff + 1, iEnd - iOff))
        IF LEN(sChunk) >= 20 THEN
            iDid = LibAdd%(sTopic, sLabel, sChunk, "")
            iCount = iCount + 1
        END IF
        iOff = iOff + 140
    LOOP
    IngestParagraph% = iCount
END FUNCTION

' paragraphs are separated by a newline, optional spaces and newlines, and another newline
FUNCTION LibIngest% (sRaw AS STRING, sLabel AS STRING)
    DIM sTxt AS STRING, iN AS LONG, iI AS LONG, iStart AS LONG, iJ AS LONG, iLast AS LONG, iFound AS INTEGER
    DIM iCount AS INTEGER, sLab AS STRING, sCh AS STRING
    IF LEN(sLabel) = 0 THEN sLab = "imported" ELSE sLab = sLabel
    sTxt = CleanAscii$(sRaw)
    iN = LEN(sTxt)
    iCount = 0
    iStart = 1
    iI = 1
    DO WHILE iI <= iN
        IF MID$(sTxt, iI, 1) = CHR$(10) THEN
            iJ = iI
            iLast = iI
            iFound = 0
            DO WHILE iJ <= iN
                sCh = MID$(sTxt, iJ, 1)
                IF sCh <> " " AND sCh <> CHR$(10) THEN EXIT DO
                IF sCh = CHR$(10) THEN
                    iLast = iJ
                    IF iLast > iI THEN iFound = -1
                END IF
                iJ = iJ + 1
            LOOP
            IF iFound THEN
                iCount = iCount + IngestParagraph%(MID$(sTxt, iStart, iI - iStart), sLab)
                iStart = iLast + 1
                iI = iStart
            ELSE
                iI = iJ
            END IF
        ELSE
            iI = iI + 1
        END IF
    LOOP
    iCount = iCount + IngestParagraph%(MID$(sTxt, iStart, iN - iStart + 1), sLab)
    LibIngest% = iCount
END FUNCTION

' one entry per line: topic TAB category TAB zFact TAB zEx
FUNCTION LibToText$ ()
    DIM sOut AS STRING, iI AS INTEGER
    sOut = ""
    FOR iI = 0 TO gLibN - 1
        sOut = sOut + aLibTopic(iI) + CHR$(9) + aLibCat(iI) + CHR$(9) + aLibZFact(iI) + CHR$(9) + aLibZEx(iI) + CHR$(10)
    NEXT iI
    LibToText$ = sOut
END FUNCTION

FUNCTION LibFromText% (sText AS STRING)
    DIM iP AS LONG, iN AS LONG, iEol AS LONG, sLine AS STRING, iT1 AS LONG, iT2 AS LONG, iT3 AS LONG, iT4 AS LONG
    DIM sTopic AS STRING, sCat AS STRING, sZf AS STRING, sZe AS STRING, iCount AS INTEGER, sFact AS STRING, iId AS INTEGER
    gLibN = 0
    iCount = 0
    iN = LEN(sText)
    iP = 1
    DO WHILE iP <= iN
        iEol = INSTR(iP, sText, CHR$(10))
        IF iEol = 0 THEN iEol = iN + 1
        sLine = MID$(sText, iP, iEol - iP)
        iP = iEol + 1
        IF RIGHT$(sLine, 1) = CHR$(13) THEN sLine = LEFT$(sLine, LEN(sLine) - 1)
        IF LEN(sLine) > 0 THEN
            iT1 = INSTR(sLine, CHR$(9))
            iT2 = 0
            iT3 = 0
            iT4 = 0
            IF iT1 > 0 THEN iT2 = INSTR(iT1 + 1, sLine, CHR$(9))
            IF iT2 > 0 THEN iT3 = INSTR(iT2 + 1, sLine, CHR$(9))
            IF iT3 > 0 THEN iT4 = INSTR(iT3 + 1, sLine, CHR$(9))
            IF iT2 > 0 AND gLibN < LIBMAX THEN
                sTopic = LEFT$(sLine, iT1 - 1)
                sCat = MID$(sLine, iT1 + 1, iT2 - iT1 - 1)
                sZe = ""
                IF iT3 = 0 THEN
                    sZf = MID$(sLine, iT2 + 1)
                ELSE
                    sZf = MID$(sLine, iT2 + 1, iT3 - iT2 - 1)
                    IF iT4 = 0 THEN sZe = MID$(sLine, iT3 + 1) ELSE sZe = MID$(sLine, iT3 + 1, iT4 - iT3 - 1)
                END IF
                iId = gLibN
                aLibTopic(iId) = sTopic
                aLibTopicLc(iId) = LCASE$(sTopic)
                aLibCat(iId) = sCat
                aLibZFact(iId) = sZf
                aLibZEx(iId) = sZe
                sFact = UnpackText$(sZf)
                aLibWords(iId) = WordSet$(sTopic, sFact)
                gLibN = gLibN + 1
                iCount = iCount + 1
            END IF
        END IF
    LOOP
    LibFromText% = iCount
END FUNCTION

' ================================================================ TNY2 neural engine
FUNCTION ReadU16% (iFile AS INTEGER)
    DIM sLo AS STRING * 1, sHi AS STRING * 1
    GET #iFile, , sLo
    GET #iFile, , sHi
    ReadU16% = ASC(sLo) + 256 * ASC(sHi)
END FUNCTION

' rows of: 4-byte scale, then iCols signed bytes
SUB LoadTable (iFile AS INTEGER, aW() AS INTEGER, aScl() AS SINGLE, lWOff AS LONG, lSOff AS LONG, iRows AS INTEGER, iCols AS INTEGER)
    DIM iR AS INTEGER, iC AS INTEGER, sngV AS SINGLE, sB AS STRING * 1, iV AS INTEGER
    FOR iR = 0 TO iRows - 1
        GET #iFile, , sngV
        aScl(lSOff + iR) = sngV
        FOR iC = 0 TO iCols - 1
            GET #iFile, , sB
            iV = ASC(sB)
            IF iV > 127 THEN iV = iV - 256
            aW(lWOff + CLNG(iR) * iCols + iC) = iV
        NEXT iC
    NEXT iR
END SUB

SUB LoadGains (iFile AS INTEGER, aG() AS SINGLE, lOff AS LONG, iN AS INTEGER)
    DIM iI AS INTEGER, sngV AS SINGLE
    FOR iI = 0 TO iN - 1
        GET #iFile, , sngV
        aG(lOff + iI) = sngV
    NEXT iI
END SUB

' 0 loaded, 1 not a TNY2 file, 2 header out of range or larger than the tables, 3 file too short
FUNCTION LoadTinyBin% (sFile AS STRING)
    DIM iFile AS INTEGER, sM1 AS STRING * 1, sM2 AS STRING * 1, sM3 AS STRING * 1, sM4 AS STRING * 1
    DIM iD AS INTEGER, iL AS INTEGER, iH AS INTEGER, iHid AS INTEGER, iLy AS INTEGER, lNeed AS LONG, lLen AS LONG
    iFile = FREEFILE
    OPEN sFile FOR BINARY AS #iFile
    lLen = LOF(iFile)
    IF lLen < 12 THEN
        CLOSE #iFile
        IF lLen = 0 THEN KILL sFile
        LoadTinyBin% = 1
        EXIT FUNCTION
    END IF
    GET #iFile, , sM1
    GET #iFile, , sM2
    GET #iFile, , sM3
    GET #iFile, , sM4
    IF sM1 <> "T" OR sM2 <> "N" OR sM3 <> "Y" OR sM4 <> "2" THEN
        CLOSE #iFile
        LoadTinyBin% = 1
        EXIT FUNCTION
    END IF
    iD = ReadU16%(iFile)
    iL = ReadU16%(iFile)
    iH = ReadU16%(iFile)
    iHid = ReadU16%(iFile)
    IF iD < 1 OR iL < 1 OR iH < 1 OR iHid < 1 THEN
        CLOSE #iFile
        LoadTinyBin% = 2
        EXIT FUNCTION
    END IF
    IF iD > MAXD OR iL > MAXL OR iHid > MAXHID OR iD MOD iH <> 0 THEN
        CLOSE #iFile
        LoadTinyBin% = 2
        EXIT FUNCTION
    END IF
    lNeed = 12 + CLNG(VOCAB + CTX) * (4 + iD)
    lNeed = lNeed + CLNG(iL) * (4& * iD + 4& * iD * (4 + iD) + 4& * iD + CLNG(iHid) * (4 + iD) + CLNG(iD) * (4 + iHid)) + 4& * iD
    IF lLen < lNeed THEN
        CLOSE #iFile
        LoadTinyBin% = 3
        EXIT FUNCTION
    END IF
    gNetLoaded = 0
    gTD = iD
    gTL = iL
    gTH = iH
    gHID = iHid
    gHD = iD \ iH
    gAttDiv = SQR(CDBL(gHD))
    CALL LoadTable(iFile, aEmbW(), aEmbS(), 0, 0, VOCAB, gTD)
    CALL LoadTable(iFile, aPosW(), aPosS(), 0, 0, CTX, gTD)
    FOR iLy = 0 TO gTL - 1
        CALL LoadGains(iFile, aG1(), CLNG(iLy) * gTD, gTD)
        CALL LoadTable(iFile, aWqW(), aWqS(), CLNG(iLy) * gTD * gTD, CLNG(iLy) * gTD, gTD, gTD)
        CALL LoadTable(iFile, aWkW(), aWkS(), CLNG(iLy) * gTD * gTD, CLNG(iLy) * gTD, gTD, gTD)
        CALL LoadTable(iFile, aWvW(), aWvS(), CLNG(iLy) * gTD * gTD, CLNG(iLy) * gTD, gTD, gTD)
        CALL LoadTable(iFile, aWoW(), aWoS(), CLNG(iLy) * gTD * gTD, CLNG(iLy) * gTD, gTD, gTD)
        CALL LoadGains(iFile, aG2(), CLNG(iLy) * gTD, gTD)
        CALL LoadTable(iFile, aF1W(), aF1S(), CLNG(iLy) * gHID * gTD, CLNG(iLy) * gHID, gHID, gTD)
        CALL LoadTable(iFile, aF2W(), aF2S(), CLNG(iLy) * gTD * gHID, CLNG(iLy) * gTD, gTD, gHID)
    NEXT iLy
    CALL LoadGains(iFile, aGf(), 0, gTD)
    CLOSE #iFile
    gKvPrefix = 0
    gNetLoaded = -1
    LoadTinyBin% = 0
END FUNCTION

' y = scale * (W x), accumulated in DOUBLE
SUB MatVec (aW() AS INTEGER, aScl() AS SINGLE, lWOff AS LONG, lSOff AS LONG, iRows AS INTEGER, iCols AS INTEGER, aX() AS SINGLE, aY() AS SINGLE)
    DIM iR AS INTEGER, iC AS INTEGER, dS AS DOUBLE, lBase AS LONG
    FOR iR = 0 TO iRows - 1
        dS = 0#
        lBase = lWOff + CLNG(iR) * iCols
        FOR iC = 0 TO iCols - 1
            dS = dS + CDBL(aX(iC)) * aW(lBase + iC)
        NEXT iC
        aY(iR) = dS * CDBL(aScl(lSOff + iR))
    NEXT iR
END SUB

SUB RmsNorm (aX() AS SINGLE, aG() AS SINGLE, lGOff AS LONG, aY() AS SINGLE)
    DIM iI AS INTEGER, dS AS DOUBLE, dInv AS DOUBLE
    dS = 0#
    FOR iI = 0 TO gTD - 1
        dS = dS + CDBL(aX(iI)) * CDBL(aX(iI))
    NEXT iI
    dInv = 1# / SQR(dS / gTD + 0.00001#)
    FOR iI = 0 TO gTD - 1
        aY(iI) = CDBL(aX(iI)) * dInv * CDBL(aG(lGOff + iI))
    NEXT iI
END SUB

' stores a vector as signed bytes in aDst() and returns its scale
FUNCTION StoreKV! (aDst() AS INTEGER, lOff AS LONG, aSrc() AS SINGLE)
    DIM iI AS INTEGER, dBig AS DOUBLE, dV AS DOUBLE, dK AS DOUBLE
    dBig = 0#
    FOR iI = 0 TO gTD - 1
        dV = ABS(CDBL(aSrc(iI)))
        IF dV > dBig THEN dBig = dV
    NEXT iI
    IF dBig < 1D-20 THEN dBig = 1D-20
    dK = 127# / dBig
    FOR iI = 0 TO gTD - 1
        dV = CDBL(aSrc(iI)) * dK
        IF dV < 0# THEN
            aDst(lOff + iI) = -INT(-dV + 0.5#)
        ELSE
            aDst(lOff + iI) = INT(dV + 0.5#)
        END IF
    NEXT iI
    StoreKV! = dBig / 127#
END FUNCTION

' one token at position iP; the next-token scores end up in aScore()
SUB NetStep (iTok AS INTEGER, iP AS INTEGER)
    DIM iI AS INTEGER, iJ AS INTEGER, iLy AS INTEGER, iHd AS INTEGER, iHo AS INTEGER
    DIM lE AS LONG, lPp AS LONG, lMat AS LONG, lKv AS LONG, lKp AS LONG, lVp AS LONG, lSo AS LONG
    DIM dBig AS DOUBLE, dSum AS DOUBLE, dS AS DOUBLE, dDiff AS DOUBLE, dWgt AS DOUBLE, dEs AS DOUBLE, dPs AS DOUBLE
    IF gNetLoaded = 0 THEN EXIT SUB
    IF iTok < 0 OR iTok >= VOCAB OR iP < 0 OR iP >= CTX THEN EXIT SUB
    lE = CLNG(iTok) * gTD
    lPp = CLNG(iP) * gTD
    dEs = aEmbS(iTok)
    dPs = aPosS(iP)
    FOR iI = 0 TO gTD - 1
        aBx(iI) = aEmbW(lE + iI) * dEs + aPosW(lPp + iI) * dPs
    NEXT iI
    FOR iLy = 0 TO gTL - 1
        lMat = CLNG(iLy) * gTD * gTD
        lSo = CLNG(iLy) * gTD
        lKv = CLNG(iLy) * CTX * gTD
        CALL RmsNorm(aBx(), aG1(), lSo, aBh())
        CALL MatVec(aWkW(), aWkS(), lMat, lSo, gTD, gTD, aBh(), aBt())
        aKs(iLy * CTX + iP) = StoreKV!(aKc(), lKv + CLNG(iP) * gTD, aBt())
        CALL MatVec(aWvW(), aWvS(), lMat, lSo, gTD, gTD, aBh(), aBt())
        aVs(iLy * CTX + iP) = StoreKV!(aVc(), lKv + CLNG(iP) * gTD, aBt())
        CALL MatVec(aWqW(), aWqS(), lMat, lSo, gTD, gTD, aBh(), aBq())
        FOR iHd = 0 TO gTH - 1
            iHo = iHd * gHD
            dBig = -1D+30
            FOR iJ = 0 TO iP
                lKp = lKv + CLNG(iJ) * gTD + iHo
                dS = 0#
                FOR iI = 0 TO gHD - 1
                    dS = dS + CDBL(aBq(iHo + iI)) * aKc(lKp + iI)
                NEXT iI
                dS = (dS * CDBL(aKs(iLy * CTX + iJ))) / gAttDiv
                aBsc(iJ) = dS
                IF dS > dBig THEN dBig = dS
            NEXT iJ
            dSum = 0#
            FOR iJ = 0 TO iP
                dDiff = CDBL(aBsc(iJ)) - dBig
                IF dDiff < -60# THEN aBsc(iJ) = 0! ELSE aBsc(iJ) = EXP(dDiff)
                dSum = dSum + CDBL(aBsc(iJ))
            NEXT iJ
            FOR iI = 0 TO gHD - 1
                aBa(iHo + iI) = 0!
            NEXT iI
            FOR iJ = 0 TO iP
                IF aBsc(iJ) <> 0! THEN
                    lVp = lKv + CLNG(iJ) * gTD + iHo
                    dWgt = (CDBL(aBsc(iJ)) * CDBL(aVs(iLy * CTX + iJ))) / dSum
                    FOR iI = 0 TO gHD - 1
                        aBa(iHo + iI) = CDBL(aBa(iHo + iI)) + dWgt * aVc(lVp + iI)
                    NEXT iI
                END IF
            NEXT iJ
        NEXT iHd
        CALL MatVec(aWoW(), aWoS(), lMat, lSo, gTD, gTD, aBa(), aBt())
        FOR iI = 0 TO gTD - 1
            aBx(iI) = CDBL(aBx(iI)) + CDBL(aBt(iI))
        NEXT iI
        CALL RmsNorm(aBx(), aG2(), lSo, aBh())
        CALL MatVec(aF1W(), aF1S(), CLNG(iLy) * gHID * gTD, CLNG(iLy) * gHID, gHID, gTD, aBh(), aBm())
        FOR iI = 0 TO gHID - 1
            IF aBm(iI) < 0! THEN aBm(iI) = 0!
        NEXT iI
        CALL MatVec(aF2W(), aF2S(), CLNG(iLy) * gTD * gHID, lSo, gTD, gHID, aBm(), aBt())
        FOR iI = 0 TO gTD - 1
            aBx(iI) = CDBL(aBx(iI)) + CDBL(aBt(iI))
        NEXT iI
    NEXT iLy
    CALL RmsNorm(aBx(), aGf(), 0, aBh())
    CALL MatVec(aEmbW(), aEmbS(), 0, 0, VOCAB, gTD, aBh(), aScore())
END SUB

' xorshift32 kept as two 16-bit halves, so no step needs more than 31 bits. Seeds from 0 to 4294967295; 0 gives the default.
SUB RngSeed (dSeed AS DOUBLE)
    DIM dS AS DOUBLE
    dS = dSeed - INT(dSeed / 4294967296#) * 4294967296#
    IF dS = 0# THEN dS = 2463534242#
    gRngHi = INT(dS / 65536#)
    gRngLo = dS - gRngHi * 65536#
END SUB

' the next number from 0 up to (not including) 1
FUNCTION RngNext# ()
    DIM lT AS LONG, lCarry AS LONG, lHi AS LONG, lLo AS LONG, lSh AS LONG, lSl AS LONG
    lT = gRngLo * 8192&
    lCarry = lT \ 65536
    lSl = lT AND 65535
    lSh = (gRngHi * 8192& + lCarry) AND 65535
    lHi = gRngHi XOR lSh
    lLo = gRngLo XOR lSl
    lLo = lLo XOR (lHi \ 2)
    lT = lLo * 32&
    lCarry = lT \ 65536
    lSl = lT AND 65535
    lSh = (lHi * 32& + lCarry) AND 65535
    gRngHi = lHi XOR lSh
    gRngLo = lLo XOR lSl
    RngNext# = (gRngHi * 65536# + gRngLo) / 4294967296#
END FUNCTION

' creativity 0 takes the best token (the first one on a tie); above 0 samples among tokens near the best
FUNCTION PickTok% (dCreat AS DOUBLE)
    DIM iI AS INTEGER, iBest AS INTEGER, dT AS DOUBLE, dSum AS DOUBLE, dD AS DOUBLE, dEx AS DOUBLE, dR AS DOUBLE
    iBest = 0
    FOR iI = 1 TO VOCAB - 1
        IF aScore(iI) > aScore(iBest) THEN iBest = iI
    NEXT iI
    IF dCreat <= 0# THEN
        PickTok% = iBest
        EXIT FUNCTION
    END IF
    dT = dCreat / 5#
    dSum = 0#
    FOR iI = 0 TO VOCAB - 1
        dD = (CDBL(aScore(iI)) - CDBL(aScore(iBest))) / dT
        IF dD < -60# THEN dEx = 0# ELSE dEx = EXP(dD)
        IF dEx < 0.15# THEN aBsc(iI) = 0! ELSE aBsc(iI) = dEx
        dSum = dSum + CDBL(aBsc(iI))
    NEXT iI
    dR = dSum * RngNext#()
    FOR iI = 0 TO VOCAB - 1
        dR = dR - CDBL(aBsc(iI))
        IF dR < 0# AND aBsc(iI) > 0! THEN
            PickTok% = iI
            EXIT FUNCTION
        END IF
    NEXT iI
    PickTok% = iBest
END FUNCTION

SUB NetReset
    gKvPrefix = 0
END SUB

' feeds text as a prefix that stays in the cache; returns the new prefix length
FUNCTION NetPrime% (sText AS STRING)
    DIM sClean AS STRING, iI AS INTEGER, iP AS INTEGER
    IF gNetLoaded = 0 THEN
        NetPrime% = 0
        EXIT FUNCTION
    END IF
    sClean = CleanAscii$(sText)
    iP = gKvPrefix
    FOR iI = 1 TO LEN(sClean)
        IF iP >= CTX - 2 THEN EXIT FOR
        IF MID$(sClean, iI, 1) = CHR$(10) THEN
            CALL NetStep(32 - 30, iP)
        ELSE
            CALL NetStep(ASC(MID$(sClean, iI, 1)) - 30, iP)
        END IF
        iP = iP + 1
    NEXT iI
    gKvPrefix = iP
    NetPrime% = iP
END FUNCTION

' text in, answer out; creativity 0 is the best-token answer
FUNCTION ThinkNet$ (sQuestion AS STRING, dCreat AS DOUBLE)
    DIM sClean AS STRING, iI AS INTEGER, iP AS INTEGER, iTok AS INTEGER, sOut AS STRING
    IF gNetLoaded = 0 THEN
        ThinkNet$ = ""
        EXIT FUNCTION
    END IF
    sClean = CleanAscii$(sQuestion)
    iP = gKvPrefix
    FOR iI = 1 TO LEN(sClean)
        IF iP >= CTX - 2 THEN EXIT FOR
        IF MID$(sClean, iI, 1) = CHR$(10) THEN
            CALL NetStep(32 - 30, iP)
        ELSE
            CALL NetStep(ASC(MID$(sClean, iI, 1)) - 30, iP)
        END IF
        iP = iP + 1
    NEXT iI
    CALL NetStep(1, iP)
    iP = iP + 1
    sOut = ""
    DO WHILE iP < CTX
        iTok = PickTok%(dCreat)
        IF iTok <= 1 THEN EXIT DO
        sOut = sOut + CHR$(iTok + 30)
        CALL NetStep(iTok, iP)
        iP = iP + 1
    LOOP
    ThinkNet$ = sOut
END FUNCTION

' ================================================================ learner profile
SUB PmReset
    gPmName = "Explorer"
    gPmMode = "M"
    gPmPace = "normal"
    gPmRoom = "camp"
    gPmXp = 0
    aPmFb(0) = 0
    aPmFb(1) = 0
    aPmFb(2) = 0
    aPmFb(3) = 0
    gPmSolvedN = 0
    gPmInvN = 0
    gPmMasteredN = 0
    gPmRecentN = 0
END SUB

FUNCTION PmSetMode$ (sM AS STRING)
    DIM sC AS STRING
    IF LEN(sM) = 0 THEN sC = "M" ELSE sC = UCASE$(LEFT$(sM, 1))
    IF sC = "R" OR sC = "A" OR sC = "D" OR sC = "M" THEN gPmMode = sC
    PmSetMode$ = gPmMode
END FUNCTION

FUNCTION ListHas% (aL() AS STRING, iN AS INTEGER, sItem AS STRING)
    DIM iI AS INTEGER
    ListHas% = 0
    FOR iI = 0 TO iN - 1
        IF aL(iI) = sItem THEN ListHas% = -1
    NEXT iI
END FUNCTION

' bonus below 0 means the default of 10
SUB PmRecord (sTopic AS STRING, lBonus AS LONG)
    IF lBonus < 0 THEN gPmXp = gPmXp + 10 ELSE gPmXp = gPmXp + lBonus
    aPmFb(INSTR("RADM", gPmMode) - 1) = aPmFb(INSTR("RADM", gPmMode) - 1) + 1
    IF LEN(sTopic) > 0 THEN
        IF ListHas%(aPmMastered(), gPmMasteredN, sTopic) = 0 AND gPmMasteredN < 64 THEN
            aPmMastered(gPmMasteredN) = sTopic
            gPmMasteredN = gPmMasteredN + 1
        END IF
    END IF
END SUB

FUNCTION PmBest$ ()
    DIM iI AS INTEGER, sBest AS STRING, lBest AS LONG
    sBest = gPmMode
    lBest = 0
    FOR iI = 0 TO 3
        IF aPmFb(iI) > lBest THEN
            lBest = aPmFb(iI)
            sBest = MID$("RADM", iI + 1, 1)
        END IF
    NEXT iI
    PmBest$ = sBest
END FUNCTION

FUNCTION SafeItem$ (sSrc AS STRING)
    DIM sOut AS STRING, iI AS INTEGER, sC AS STRING
    sOut = ""
    FOR iI = 1 TO LEN(sSrc)
        sC = MID$(sSrc, iI, 1)
        IF sC = "|" OR sC = CHR$(13) OR sC = CHR$(10) THEN sOut = sOut + " " ELSE sOut = sOut + sC
    NEXT iI
    SafeItem$ = sOut
END FUNCTION

FUNCTION JoinList$ (aL() AS STRING, iN AS INTEGER)
    DIM sOut AS STRING, iI AS INTEGER
    sOut = ""
    FOR iI = 0 TO iN - 1
        IF iI > 0 THEN sOut = sOut + "|"
        sOut = sOut + SafeItem$(aL(iI))
    NEXT iI
    JoinList$ = sOut
END FUNCTION

' splits on "|" into aL(); returns the count (items past the table size are dropped)
FUNCTION SplitList% (sSrc AS STRING, aL() AS STRING)
    DIM iN AS INTEGER, iStart AS INTEGER, iBar AS INTEGER, iCap AS INTEGER
    iCap = UBOUND(aL) + 1
    iN = 0
    IF LEN(sSrc) = 0 THEN
        SplitList% = 0
        EXIT FUNCTION
    END IF
    iStart = 1
    DO
        iBar = INSTR(iStart, sSrc, "|")
        IF iBar = 0 THEN
            IF iN < iCap THEN aL(iN) = MID$(sSrc, iStart)
            iN = iN + 1
            EXIT DO
        END IF
        IF iN < iCap THEN aL(iN) = MID$(sSrc, iStart, iBar - iStart)
        iN = iN + 1
        iStart = iBar + 1
    LOOP
    IF iN > iCap THEN iN = iCap
    SplitList% = iN
END FUNCTION

FUNCTION PmToCfg$ ()
    DIM sOut AS STRING, sNl AS STRING
    sNl = CHR$(10)
    sOut = "NAME=" + gPmName + sNl
    sOut = sOut + "MODE=" + gPmMode + sNl
    sOut = sOut + "PACE=" + gPmPace + sNl
    sOut = sOut + "XP=" + IntStr$(gPmXp) + sNl
    sOut = sOut + "FB=" + IntStr$(aPmFb(0)) + "," + IntStr$(aPmFb(1)) + "," + IntStr$(aPmFb(2)) + "," + IntStr$(aPmFb(3)) + sNl
    sOut = sOut + "ROOM=" + gPmRoom + sNl
    sOut = sOut + "SOLVED=" + JoinList$(aPmSolved(), gPmSolvedN) + sNl
    sOut = sOut + "INV=" + JoinList$(aPmInv(), gPmInvN) + sNl
    sOut = sOut + "MASTERED=" + JoinList$(aPmMastered(), gPmMasteredN) + sNl
    sOut = sOut + "RECENT=" + JoinList$(aPmRecent(), gPmRecentN) + sNl
    PmToCfg$ = sOut
END FUNCTION

SUB PmFromCfg (sText AS STRING)
    DIM iP AS LONG, iN AS LONG, iEol AS LONG, sLine AS STRING, iEq AS INTEGER, sKey AS STRING, sVal AS STRING
    DIM iK AS INTEGER, iBar AS INTEGER, iStart AS INTEGER
    CALL PmReset
    iN = LEN(sText)
    iP = 1
    DO WHILE iP <= iN
        iEol = INSTR(iP, sText, CHR$(10))
        IF iEol = 0 THEN iEol = iN + 1
        sLine = MID$(sText, iP, iEol - iP)
        iP = iEol + 1
        IF RIGHT$(sLine, 1) = CHR$(13) THEN sLine = LEFT$(sLine, LEN(sLine) - 1)
        iEq = INSTR(sLine, "=")
        IF iEq > 1 THEN
            sKey = LEFT$(sLine, iEq - 1)
            sVal = MID$(sLine, iEq + 1)
            IF sKey = "NAME" THEN
                IF LEN(sVal) = 0 THEN gPmName = "Explorer" ELSE gPmName = LEFT$(sVal, 63)
            ELSEIF sKey = "MODE" THEN
                IF LEN(sVal) > 0 THEN
                    IF INSTR("RADM", LEFT$(sVal, 1)) > 0 THEN gPmMode = LEFT$(sVal, 1)
                END IF
            ELSEIF sKey = "PACE" THEN
                IF LEN(sVal) = 0 THEN gPmPace = "normal" ELSE gPmPace = LEFT$(sVal, 31)
            ELSEIF sKey = "XP" THEN
                gPmXp = INT(ValOf#(sVal))
            ELSEIF sKey = "FB" THEN
                iStart = 1
                FOR iK = 0 TO 3
                    aPmFb(iK) = 0
                    IF iStart <= LEN(sVal) + 1 THEN
                        aPmFb(iK) = INT(ValOf#(MID$(sVal, iStart)))
                        iBar = INSTR(iStart, sVal, ",")
                        IF iBar = 0 THEN iStart = LEN(sVal) + 2 ELSE iStart = iBar + 1
                    END IF
                NEXT iK
            ELSEIF sKey = "ROOM" THEN
                IF LEN(sVal) = 0 THEN gPmRoom = "camp" ELSE gPmRoom = LEFT$(sVal, 15)
            ELSEIF sKey = "SOLVED" THEN
                gPmSolvedN = SplitList%(sVal, aPmSolved())
            ELSEIF sKey = "INV" THEN
                gPmInvN = SplitList%(sVal, aPmInv())
            ELSEIF sKey = "MASTERED" THEN
                gPmMasteredN = SplitList%(sVal, aPmMastered())
            ELSEIF sKey = "RECENT" THEN
                gPmRecentN = SplitList%(sVal, aPmRecent())
            END IF
        END IF
    LOOP
END SUB

' ================================================================ audio
FUNCTION ChirpFreq% (iC AS INTEGER)
    IF iC = 32 THEN ChirpFreq% = 0 ELSE ChirpFreq% = 280 + (iC MOD 24) * 35
END FUNCTION

' a tone on the PC speaker; other systems stay silent
SUB PlayTone (iFreq AS INTEGER, iMs AS INTEGER)
#IFDEF __FB_DOS__
    DIM iDiv AS INTEGER
    IF iFreq > 0 THEN
        iDiv = 1193180 \ iFreq
        OUT &H43, &HB6
        OUT &H42, iDiv AND 255
        OUT &H42, (iDiv \ 256) AND 255
        OUT &H61, INP(&H61) OR 3
        SLEEP iMs
        OUT &H61, INP(&H61) AND 252
    END IF
#ENDIF
END SUB

' audio and mix modes say the text; read and do modes stay quiet
SUB Speak (sText AS STRING)
    DIM iI AS INTEGER, iN AS INTEGER
    IF gPmMode = "R" OR gPmMode = "D" THEN EXIT SUB
    gLastSpoken = sText
    iN = LEN(sText)
    IF iN > 14 THEN iN = 14
    FOR iI = 1 TO iN
        CALL PlayTone(ChirpFreq%(ASC(MID$(sText, iI, 1))), 42)
    NEXT iI
END SUB

' ================================================================ coding sandbox
' tokens: "text", names, numbers, <= >= == != and one-character operators; anything else is skipped
SUB TokenizeExpr (sSrc AS STRING)
    DIM iP AS INTEGER, iN AS INTEGER, iC AS INTEGER, iSt AS INTEGER, sTwo AS STRING
    gTkN = 0
    iN = LEN(sSrc)
    iP = 1
    DO WHILE iP <= iN AND gTkN < 256
        iC = ASC(MID$(sSrc, iP, 1))
        IF iC = 34 THEN
            iSt = INSTR(iP + 1, sSrc, CHR$(34))
            IF iSt > 0 THEN
                aTk(gTkN) = MID$(sSrc, iP, iSt - iP + 1)
                gTkN = gTkN + 1
                iP = iSt + 1
            ELSE
                iP = iP + 1
            END IF
        ELSEIF IsAlpha%(iC) OR iC = 95 THEN
            iSt = iP
            DO WHILE iP <= iN
                iC = ASC(MID$(sSrc, iP, 1))
                IF IsAlnum%(iC) = 0 AND iC <> 95 THEN EXIT DO
                iP = iP + 1
            LOOP
            aTk(gTkN) = MID$(sSrc, iSt, iP - iSt)
            gTkN = gTkN + 1
        ELSEIF IsDigit%(iC) THEN
            iSt = iP
            DO WHILE iP <= iN
                IF IsDigit%(ASC(MID$(sSrc, iP, 1))) = 0 THEN EXIT DO
                iP = iP + 1
            LOOP
            IF iP < iN THEN
                IF MID$(sSrc, iP, 1) = "." AND IsDigit%(ASC(MID$(sSrc, iP + 1, 1))) THEN
                    iP = iP + 1
                    DO WHILE iP <= iN
                        IF IsDigit%(ASC(MID$(sSrc, iP, 1))) = 0 THEN EXIT DO
                        iP = iP + 1
                    LOOP
                END IF
            END IF
            aTk(gTkN) = MID$(sSrc, iSt, iP - iSt)
            gTkN = gTkN + 1
        ELSE
            sTwo = MID$(sSrc, iP, 2)
            IF sTwo = "<=" OR sTwo = ">=" OR sTwo = "==" OR sTwo = "!=" THEN
                aTk(gTkN) = sTwo
                gTkN = gTkN + 1
                iP = iP + 2
            ELSEIF INSTR("+-*/%()<>=", CHR$(iC)) > 0 THEN
                aTk(gTkN) = CHR$(iC)
                gTkN = gTkN + 1
                iP = iP + 1
            ELSE
                iP = iP + 1
            END IF
        END IF
    LOOP
END SUB

FUNCTION ResultNum# ()
    IF gRIsStr THEN ResultNum# = ValOf#(gRStr) ELSE ResultNum# = gRNum
END FUNCTION

FUNCTION ResultText$ ()
    IF gRIsStr THEN ResultText$ = gRStr ELSE ResultText$ = FmtNum$(gRNum)
END FUNCTION

SUB SetNum (dV AS DOUBLE)
    gRIsStr = 0
    gRNum = dV
    gRStr = ""
END SUB

SUB SetStr (sV AS STRING)
    gRIsStr = -1
    gRNum = 0#
    gRStr = sV
END SUB

FUNCTION VarFind% (sKey AS STRING)
    DIM iI AS INTEGER
    VarFind% = -1
    FOR iI = 0 TO gVN - 1
        IF aVName(iI) = sKey THEN VarFind% = iI
    NEXT iI
END FUNCTION

SUB SbClearVars
    gVN = 0
END SUB

SUB ParseFactor
    DIM sT AS STRING, iV AS INTEGER, dN AS DOUBLE
    IF gTkPos >= gTkN THEN
        CALL SetNum(0#)
        EXIT SUB
    END IF
    sT = aTk(gTkPos)
    gTkPos = gTkPos + 1
    IF sT = "(" THEN
        CALL ParseComparison
        IF gTkPos < gTkN THEN
            IF aTk(gTkPos) = ")" THEN gTkPos = gTkPos + 1
        END IF
    ELSEIF sT = "-" THEN
        CALL ParseFactor
        dN = ResultNum#()
        CALL SetNum(-dN)
    ELSEIF LEFT$(sT, 1) = CHR$(34) THEN
        CALL SetStr(MID$(sT, 2, LEN(sT) - 2))
    ELSEIF IsDigit%(ASC(LEFT$(sT, 1))) THEN
        CALL SetNum(ValOf#(sT))
    ELSE
        iV = VarFind%(UCASE$(sT))
        IF iV < 0 THEN
            CALL SetNum(0#)
        ELSEIF aVIsStr(iV) THEN
            CALL SetStr(aVStr(iV))
        ELSE
            CALL SetNum(aVNum(iV))
        END IF
    END IF
END SUB

SUB ParseMul
    DIM sOp AS STRING, dL AS DOUBLE, dR AS DOUBLE
    CALL ParseFactor
    DO WHILE gTkPos < gTkN
        sOp = aTk(gTkPos)
        IF sOp <> "*" AND sOp <> "/" AND sOp <> "%" THEN EXIT DO
        gTkPos = gTkPos + 1
        dL = ResultNum#()
        CALL ParseFactor
        dR = ResultNum#()
        IF sOp = "*" THEN
            CALL SetNum(dL * dR)
        ELSEIF sOp = "/" THEN
            IF dR = 0# THEN CALL SetNum(0#) ELSE CALL SetNum(dL / dR)
        ELSE
            IF dR = 0# THEN CALL SetNum(0#) ELSE CALL SetNum(dL - dR * FIX(dL / dR))
        END IF
    LOOP
END SUB

SUB ParseAdd
    DIM sOp AS STRING, iLStr AS INTEGER, dL AS DOUBLE, sL AS STRING
    CALL ParseMul
    DO WHILE gTkPos < gTkN
        sOp = aTk(gTkPos)
        IF sOp <> "+" AND sOp <> "-" THEN EXIT DO
        gTkPos = gTkPos + 1
        iLStr = gRIsStr
        dL = gRNum
        sL = gRStr
        CALL ParseMul
        IF sOp = "+" THEN
            IF iLStr OR gRIsStr THEN
                IF iLStr THEN sL = sL ELSE sL = FmtNum$(dL)
                CALL SetStr(sL + ResultText$())
            ELSE
                CALL SetNum(dL + gRNum)
            END IF
        ELSE
            IF iLStr THEN dL = ValOf#(sL)
            CALL SetNum(dL - ResultNum#())
        END IF
    LOOP
END SUB

SUB ParseComparison
    DIM sOp AS STRING, iLStr AS INTEGER, dL AS DOUBLE, sL AS STRING, iC AS INTEGER, dR AS DOUBLE, iRes AS INTEGER
    CALL ParseAdd
    IF gTkPos >= gTkN THEN EXIT SUB
    sOp = aTk(gTkPos)
    IF sOp = "<" OR sOp = ">" OR sOp = "<=" OR sOp = ">=" OR sOp = "==" OR sOp = "!=" OR sOp = "=" THEN
        gTkPos = gTkPos + 1
        iLStr = gRIsStr
        dL = gRNum
        sL = gRStr
        CALL ParseAdd
        IF iLStr AND gRIsStr THEN
            IF sL < gRStr THEN
                iC = -1
            ELSEIF sL > gRStr THEN
                iC = 1
            ELSE
                iC = 0
            END IF
        ELSE
            IF iLStr THEN dL = ValOf#(sL)
            dR = ResultNum#()
            IF dL < dR THEN
                iC = -1
            ELSEIF dL > dR THEN
                iC = 1
            ELSE
                iC = 0
            END IF
        END IF
        iRes = 0
        IF sOp = "<" THEN
            IF iC < 0 THEN iRes = 1
        ELSEIF sOp = ">" THEN
            IF iC > 0 THEN iRes = 1
        ELSEIF sOp = "<=" THEN
            IF iC <= 0 THEN iRes = 1
        ELSEIF sOp = ">=" THEN
            IF iC >= 0 THEN iRes = 1
        ELSEIF sOp = "!=" THEN
            IF iC <> 0 THEN iRes = 1
        ELSE
            IF iC = 0 THEN iRes = 1
        END IF
        CALL SetNum(CDBL(iRes))
    END IF
END SUB

' result in gRIsStr / gRNum / gRStr; names come from the sandbox variable table
SUB EvalExpr (sExpr AS STRING)
    CALL TokenizeExpr(sExpr)
    gTkPos = 0
    CALL ParseComparison
END SUB

FUNCTION ResultTrue% ()
    IF gRIsStr THEN
        IF LEN(gRStr) > 0 THEN ResultTrue% = -1 ELSE ResultTrue% = 0
    ELSE
        IF gRNum <> 0# THEN ResultTrue% = -1 ELSE ResultTrue% = 0
    END IF
END FUNCTION

SUB VarSet (sKey AS STRING)
    DIM iV AS INTEGER
    iV = VarFind%(sKey)
    IF iV < 0 THEN
        IF gVN >= 64 THEN EXIT SUB
        iV = gVN
        gVN = gVN + 1
        aVName(iV) = sKey
    END IF
    aVIsStr(iV) = gRIsStr
    aVNum(iV) = gRNum
    aVStr(iV) = gRStr
END SUB

SUB RunFail (sMsg AS STRING)
    gRunOk = 0
    gRunErr = sMsg
END SUB

FUNCTION RenderGrid$ (aG() AS INTEGER, iTx AS INTEGER, iTy AS INTEGER)
    DIM iR AS INTEGER, iC AS INTEGER, sOut AS STRING
    sOut = ""
    FOR iR = 0 TO 11
        IF iR > 0 THEN sOut = sOut + CHR$(10)
        FOR iC = 0 TO 11
            IF iC > 0 THEN sOut = sOut + " "
            IF iR = iTy AND iC = iTx THEN sOut = sOut + "@" ELSE sOut = sOut + CHR$(aG(iR * 12 + iC))
        NEXT iC
    NEXT iR
    RenderGrid$ = sOut
END FUNCTION

' runs a program (lines separated by newlines); results in gRunOk, gRunErr, aOut(), gGrid and the variable table
SUB SbRun (sSource AS STRING)
    DIM aG(143) AS INTEGER, aStack(399) AS INTEGER
    DIM iTx AS INTEGER, iTy AS INTEGER, iDir AS INTEGER, iNLines AS INTEGER, iI AS INTEGER, iSp AS INTEGER, iPc AS INTEGER
    DIM iSteps AS INTEGER, iP AS INTEGER, iEol AS INTEGER, iR AS INTEGER, iC AS INTEGER, iThen AS INTEGER, iEq AS INTEGER, iM AS INTEGER
    DIM iDist AS INTEGER, iHead AS INTEGER, iOk AS INTEGER
    DIM sRaw AS STRING, sUp AS STRING, sLine AS STRING, sName AS STRING, sCond AS STRING, sTurn AS STRING
    DIM dCnt AS DOUBLE, dD AS DOUBLE
    gRunOk = 0
    gRunErr = ""
    gOutN = 0
    gGrid = ""
    gVN = 0
    FOR iI = 0 TO 143
        aG(iI) = 46
    NEXT iI
    iTx = 4
    iTy = 4
    iDir = 0
    aG(iTy * 12 + iTx) = 35
    ' split into lines
    iNLines = 0
    iP = 1
    DO
        iEol = INSTR(iP, sSource, CHR$(10))
        IF iEol = 0 THEN
            sLine = MID$(sSource, iP)
        ELSE
            sLine = MID$(sSource, iP, iEol - iP)
        END IF
        IF RIGHT$(sLine, 1) = CHR$(13) THEN sLine = LEFT$(sLine, LEN(sLine) - 1)
        IF iNLines >= 400 THEN
            CALL RunFail("Program is longer than 400 lines")
            EXIT SUB
        END IF
        aLn(iNLines) = sLine
        iNLines = iNLines + 1
        IF iEol = 0 THEN EXIT DO
        iP = iEol + 1
    LOOP
    FOR iI = 0 TO iNLines - 1
        aJump(iI) = -1
        aCount(iI) = 0#
    NEXT iI
    ' match REPEAT and END
    iSp = 0
    FOR iI = 0 TO iNLines - 1
        sUp = UCASE$(TrimWs$(aLn(iI)))
        IF LEFT$(sUp, 7) = "REPEAT " THEN
            aStack(iSp) = iI
            iSp = iSp + 1
        ELSEIF sUp = "END" THEN
            IF iSp = 0 THEN
                CALL RunFail("Line " + IntStr$(CLNG(iI + 1)) + ": END without REPEAT")
                EXIT SUB
            END IF
            iSp = iSp - 1
            aJump(iI) = aStack(iSp)
            aJump(aStack(iSp)) = iI
        END IF
    NEXT iI
    IF iSp > 0 THEN
        CALL RunFail("Missing END for REPEAT")
        EXIT SUB
    END IF
    iPc = 0
    iSteps = 0
    DO WHILE iPc < iNLines
        iSteps = iSteps + 1
        IF iSteps > 500 THEN
            CALL RunFail("Stopped after 500 steps (loop limit)")
            gGrid = RenderGrid$(aG(), iTx, iTy)
            EXIT SUB
        END IF
        sRaw = TrimWs$(aLn(iPc))
        IF LEN(sRaw) = 0 OR LEFT$(sRaw, 1) = "#" THEN
            iPc = iPc + 1
        ELSE
            sUp = UCASE$(sRaw)
            iOk = -1
            IF LEFT$(sUp, 3) = "IF " THEN
                iThen = INSTR(sUp, " THEN ")
                IF iThen = 0 THEN
                    CALL RunFail("Line " + IntStr$(CLNG(iPc + 1)) + ": IF needs THEN")
                    EXIT SUB
                END IF
                sCond = MID$(sRaw, 4, iThen - 4)
                CALL EvalExpr(sCond)
                IF ResultTrue%() = 0 THEN
                    iOk = 0
                ELSE
                    sRaw = TrimWs$(MID$(sRaw, iThen + 6))
                    sUp = UCASE$(sRaw)
                END IF
            END IF
            IF iOk = 0 THEN
                iPc = iPc + 1
            ELSE
                IF LEFT$(sUp, 4) = "LET " THEN
                    iEq = INSTR(sRaw, "=")
                    IF iEq = 0 THEN
                        CALL RunFail("Line " + IntStr$(CLNG(iPc + 1)) + ": LET needs '='")
                        EXIT SUB
                    END IF
                    sName = TrimWs$(MID$(sRaw, 5, iEq - 5))
                    iOk = LEN(sName) > 0
                    IF iOk THEN
                        IF IsAlpha%(ASC(LEFT$(sName, 1))) = 0 AND LEFT$(sName, 1) <> "_" THEN iOk = 0
                    END IF
                    FOR iI = 2 TO LEN(sName)
                        iC = ASC(MID$(sName, iI, 1))
                        IF IsAlnum%(iC) = 0 AND iC <> 95 THEN iOk = 0
                    NEXT iI
                    IF iOk = 0 THEN
                        CALL RunFail("Line " + IntStr$(CLNG(iPc + 1)) + ": bad variable name '" + sName + "'")
                        EXIT SUB
                    END IF
                    CALL EvalExpr(MID$(sRaw, iEq + 1))
                    CALL VarSet(UCASE$(sName))
                    iPc = iPc + 1
                ELSEIF LEFT$(sUp, 6) = "PRINT " THEN
                    CALL EvalExpr(MID$(sRaw, 7))
                    IF gOutN < 600 THEN
                        aOut(gOutN) = ResultText$()
                        gOutN = gOutN + 1
                    END IF
                    iPc = iPc + 1
                ELSEIF sUp = "CLEAR" THEN
                    FOR iI = 0 TO 143
                        aG(iI) = 46
                    NEXT iI
                    iTx = 4
                    iTy = 4
                    iDir = 0
                    aG(iTy * 12 + iTx) = 35
                    iPc = iPc + 1
                ELSEIF LEFT$(sUp, 5) = "MOVE " THEN
                    CALL EvalExpr(MID$(sRaw, 6))
                    dD = INT(ResultNum#())
                    IF dD > 20# THEN dD = 20#
                    IF dD < 0# THEN dD = 0#
                    iDist = CINT(dD)
                    FOR iM = 1 TO iDist
                        IF iDir = 0 THEN iTx = iTx + 1
                        IF iDir = 1 THEN iTy = iTy + 1
                        IF iDir = 2 THEN iTx = iTx - 1
                        IF iDir = 3 THEN iTy = iTy - 1
                        IF iTx < 0 THEN iTx = 0
                        IF iTx > 11 THEN iTx = 11
                        IF iTy < 0 THEN iTy = 0
                        IF iTy > 11 THEN iTy = 11
                        aG(iTy * 12 + iTx) = 35
                    NEXT iM
                    iPc = iPc + 1
                ELSEIF LEFT$(sUp, 5) = "TURN " THEN
                    sTurn = TrimWs$(MID$(sUp, 6))
                    IF sTurn = "LEFT" THEN iDir = (iDir + 3) MOD 4 ELSE iDir = (iDir + 1) MOD 4
                    iPc = iPc + 1
                ELSEIF LEFT$(sUp, 7) = "REPEAT " THEN
                    CALL EvalExpr(MID$(sRaw, 8))
                    dCnt = INT(ResultNum#())
                    IF dCnt < 0# THEN dCnt = 0#
                    IF dCnt = 0# AND aJump(iPc) >= 0 THEN
                        iPc = aJump(iPc) + 1
                    ELSE
                        aCount(iPc) = dCnt
                        iPc = iPc + 1
                    END IF
                ELSEIF sUp = "END" THEN
                    iHead = aJump(iPc)
                    IF iHead >= 0 THEN
                        aCount(iHead) = aCount(iHead) - 1#
                        IF aCount(iHead) > 0# THEN
                            iPc = iHead + 1
                        ELSE
                            iPc = iPc + 1
                        END IF
                    ELSE
                        iPc = iPc + 1
                    END IF
                ELSE
                    CALL RunFail("Line " + IntStr$(CLNG(iPc + 1)) + ": Unknown command '" + sRaw + "'")
                    EXIT SUB
                END IF
            END IF
        END IF
    LOOP
    gRunOk = -1
    gGrid = RenderGrid$(aG(), iTx, iTy)
END SUB

' ================================================================ adventure
FUNCTION FindRoom% ()
    DIM iI AS INTEGER
    FindRoom% = 1
    FOR iI = 1 TO 4
        IF rmId(iI) = gPmRoom THEN FindRoom% = iI
    NEXT iI
END FUNCTION

FUNCTION AdvLook$ ()
    DIM iR AS INTEGER, sOut AS STRING
    iR = FindRoom%()
    sOut = "== " + rmTitle(iR) + " ==" + CHR$(10) + rmDesc(iR) + CHR$(10)
    IF ListHas%(aPmSolved(), gPmSolvedN, rmPid(iR)) THEN
        sOut = sOut + "[Solved! Reward: " + rmReward(iR) + "]"
    ELSE
        sOut = sOut + rmPrompt(iR)
    END IF
    AdvLook$ = sOut + CHR$(10) + "Commands: GO <dir>, ANSWER <text>, HINT"
END FUNCTION

FUNCTION AdvCommand$ (sCmd AS STRING)
    DIM sRaw AS STRING, sUp AS STRING, sDir AS STRING, sAns AS STRING, sOut AS STRING
    DIM iR AS INTEGER, iI AS INTEGER, iN AS INTEGER
    sRaw = TrimWs$(sCmd)
    sUp = UCASE$(sRaw)
    iR = FindRoom%()
    IF LEN(sUp) = 0 OR sUp = "LOOK" THEN
        AdvCommand$ = AdvLook$()
        EXIT FUNCTION
    END IF
    IF LEFT$(sUp, 3) = "GO " THEN
        sDir = LCASE$(TrimWs$(MID$(sRaw, 4)))
        FOR iI = 1 TO rmNEx(iR)
            IF rmExDir(iR, iI) = sDir THEN
                gPmRoom = rmExRoom(iR, iI)
                AdvCommand$ = AdvLook$()
                EXIT FUNCTION
            END IF
        NEXT iI
        sOut = "You can't go '" + sDir + "'. Exits: "
        FOR iI = 1 TO rmNEx(iR)
            IF iI > 1 THEN sOut = sOut + ", "
            sOut = sOut + rmExDir(iR, iI)
        NEXT iI
        AdvCommand$ = sOut
        EXIT FUNCTION
    END IF
    IF sUp = "HINT" THEN
        iN = LibSearch%(rmHint(iR), 1)
        IF iN > 0 THEN
            CALL LibRead(aHit(0))
            sOut = "[Library Hint - " + aLibTopic(aHit(0)) + "] " + gRdFact
            IF LEN(gRdEx) > 0 THEN sOut = sOut + CHR$(10) + "Example: " + gRdEx
        ELSE
            sOut = "Try checking the Library for: " + rmHint(iR)
        END IF
        AdvCommand$ = sOut
        EXIT FUNCTION
    END IF
    IF LEFT$(sUp, 7) = "ANSWER " THEN sAns = LCASE$(MID$(sRaw, 8)) ELSE sAns = LCASE$(sRaw)
    FOR iI = 1 TO rmNKw(iR)
        IF INSTR(sAns, rmKw(iR, iI)) > 0 THEN
            IF ListHas%(aPmSolved(), gPmSolvedN, rmPid(iR)) = 0 THEN
                IF gPmSolvedN < 16 THEN
                    aPmSolved(gPmSolvedN) = rmPid(iR)
                    gPmSolvedN = gPmSolvedN + 1
                END IF
                IF gPmInvN < 16 THEN
                    aPmInv(gPmInvN) = rmReward(iR)
                    gPmInvN = gPmInvN + 1
                END IF
                CALL PmRecord(rmHint(iR), CLNG(rmXp(iR)))
            END IF
            AdvCommand$ = "CORRECT! Unlocked: " + rmReward(iR) + CHR$(10) + "XP: " + IntStr$(gPmXp)
            EXIT FUNCTION
        END IF
    NEXT iI
    AdvCommand$ = "Not quite! Type HINT to pull knowledge from the compressed library, or try again."
END FUNCTION

' ================================================================ tutor
' "what is 18*4 ?": optional "what is ", digits, one operator, digits. Returns the expression or "".
FUNCTION MatchArithmetic$ (sQ AS STRING)
    DIM iP AS INTEGER, iN AS INTEGER, iSt AS INTEGER, sC AS STRING
    iN = LEN(sQ)
    iP = 1
    IF LCASE$(LEFT$(sQ, 8)) = "what is " THEN
        iP = 9
        DO WHILE iP <= iN
            IF MID$(sQ, iP, 1) <> " " THEN EXIT DO
            iP = iP + 1
        LOOP
    END IF
    iSt = iP
    IF iP > iN THEN
        MatchArithmetic$ = ""
        EXIT FUNCTION
    END IF
    IF IsDigit%(ASC(MID$(sQ, iP, 1))) = 0 THEN
        MatchArithmetic$ = ""
        EXIT FUNCTION
    END IF
    DO WHILE iP <= iN
        IF IsDigit%(ASC(MID$(sQ, iP, 1))) = 0 THEN EXIT DO
        iP = iP + 1
    LOOP
    DO WHILE iP <= iN
        IF MID$(sQ, iP, 1) <> " " THEN EXIT DO
        iP = iP + 1
    LOOP
    IF iP > iN THEN
        MatchArithmetic$ = ""
        EXIT FUNCTION
    END IF
    IF INSTR("+-*/%", MID$(sQ, iP, 1)) = 0 THEN
        MatchArithmetic$ = ""
        EXIT FUNCTION
    END IF
    iP = iP + 1
    DO WHILE iP <= iN
        IF MID$(sQ, iP, 1) <> " " THEN EXIT DO
        iP = iP + 1
    LOOP
    IF iP > iN THEN
        MatchArithmetic$ = ""
        EXIT FUNCTION
    END IF
    IF IsDigit%(ASC(MID$(sQ, iP, 1))) = 0 THEN
        MatchArithmetic$ = ""
        EXIT FUNCTION
    END IF
    DO WHILE iP <= iN
        IF IsDigit%(ASC(MID$(sQ, iP, 1))) = 0 THEN EXIT DO
        iP = iP + 1
    LOOP
    sC = MID$(sQ, iSt, iP - iSt)
    DO WHILE iP <= iN
        IF MID$(sQ, iP, 1) <> " " THEN EXIT DO
        iP = iP + 1
    LOOP
    IF iP <= iN THEN
        IF MID$(sQ, iP, 1) = "?" THEN iP = iP + 1
    END IF
    DO WHILE iP <= iN
        IF MID$(sQ, iP, 1) <> " " THEN EXIT DO
        iP = iP + 1
    LOOP
    IF iP <= iN THEN
        MatchArithmetic$ = ""
    ELSE
        MatchArithmetic$ = sC
    END IF
END FUNCTION

' shapes a library record (or none) for the learner's mode; sets gTutSource
FUNCTION FormatModality$ (sQuestion AS STRING, iHave AS INTEGER, sTopic AS STRING, sFact AS STRING, sEx AS STRING, sNn AS STRING)
    DIM sOut AS STRING, sSpeak AS STRING
    IF iHave = 0 THEN
        IF LEN(sNn) > 0 THEN
            gTutSource = "TNY2 Neural Weights"
            FormatModality$ = sNn
        ELSE
            gTutSource = "Offline Guide"
            FormatModality$ = "I could not find '" + sQuestion + "' in the local Library yet. Try importing a .txt encyclopedia or asking about science, math, survival, or coding!"
        END IF
        EXIT FUNCTION
    END IF
    IF gPmMode = "R" THEN
        sOut = "[READ] " + UCASE$(sTopic) + CHR$(10) + sFact
        IF LEN(sEx) > 0 THEN sOut = sOut + CHR$(10) + "Note: " + sEx
    ELSEIF gPmMode = "A" THEN
        sOut = "[AUDIO] " + sFact
        IF LEN(sEx) > 0 THEN sOut = sOut + " Example: " + sEx
    ELSEIF gPmMode = "D" THEN
        sOut = "[DO] Try applying '" + sTopic + "':" + CHR$(10)
        IF LEN(sEx) > 0 THEN sOut = sOut + "Action: " + sEx ELSE sOut = sOut + "Fact: " + sFact
        sOut = sOut + CHR$(10) + "Mini-Check: Can you explain '" + sTopic + "' in your own words or test it in Code/Adventure?"
    ELSE
        sOut = "[MIX] " + sFact
        IF LEN(sEx) > 0 THEN sOut = sOut + CHR$(10) + "Applied Example: " + sEx
        IF LEN(sNn) > 0 THEN sOut = sOut + CHR$(10) + "Tiny-Net says: " + sNn
    END IF
    sSpeak = sFact
    IF LEN(sEx) > 0 THEN sSpeak = sSpeak + " Example: " + sEx
    CALL Speak(sSpeak)
    CALL PmRecord(sTopic, -1)
    IF LEN(sNn) > 0 THEN gTutSource = "Library + TNY2" ELSE gTutSource = "Compressed Library"
    FormatModality$ = sOut
END FUNCTION

' answers a question; the label of where the answer came from is left in gTutSource
FUNCTION TutorAsk$ (sQuestion AS STRING)
    DIM sQ AS STRING, sExpr AS STRING, sNum AS STRING, sFact AS STRING, sEx AS STRING, sNn AS STRING, sPrompt AS STRING, sTopic AS STRING
    DIM iN AS INTEGER, iI AS INTEGER, iHave AS INTEGER
    sQ = CleanAscii$(sQuestion)
    IF gPmRecentN >= 20 THEN
        FOR iI = 1 TO 19
            aPmRecent(iI - 1) = aPmRecent(iI)
        NEXT iI
        gPmRecentN = 19
    END IF
    aPmRecent(gPmRecentN) = sQ
    gPmRecentN = gPmRecentN + 1
    sExpr = MatchArithmetic$(sQ)
    IF LEN(sExpr) > 0 THEN
        CALL SbClearVars
        CALL EvalExpr(sExpr)
        sNum = FmtNum$(ResultNum#())
        TutorAsk$ = FormatModality$(sQ, -1, "arithmetic", sExpr + " = " + sNum, "If you split or group " + sExpr + ", the result is " + sNum + ".", "")
        EXIT FUNCTION
    END IF
    iN = LibSearch%(sQ, 1)
    iHave = 0
    sFact = ""
    sEx = ""
    sTopic = ""
    IF iN > 0 THEN
        iHave = -1
        CALL LibRead(aHit(0))
        sFact = gRdFact
        sEx = gRdEx
        sTopic = aLibTopic(aHit(0))
    END IF
    sNn = ""
    IF gNetLoaded THEN
        IF iHave THEN
            sPrompt = gPmMode + ":" + LEFT$(sFact, 40) + "|" + LEFT$(sQ, 30)
        ELSE
            sPrompt = sQ
        END IF
        sNn = ThinkNet$(sPrompt, 0#)
    END IF
    TutorAsk$ = FormatModality$(sQ, iHave, sTopic, sFact, sEx, sNn)
END FUNCTION
