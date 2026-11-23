' evelyn_extra.bi - the parts of Evelyn that the JavaScript and C editions have beyond the basics:
' KV21 cache export and import, the packet codecs for slow links, the integer dot product,
' a checksum, and several shelves of knowledge with the pre-answer number checker.
' Needs evelyn_core.bi first. Same file layouts as js/evelyn_core.js.

CONST MSMAX = 200

DIM SHARED gMsShelfN AS INTEGER, aMsName(7) AS STRING, aMsCount(7) AS INTEGER
DIM SHARED gMsN AS INTEGER, aMsShelf(MSMAX) AS INTEGER, aMsId(MSMAX) AS INTEGER
DIM SHARED aMsTopic(MSMAX) AS STRING, aMsTopicLc(MSMAX) AS STRING, aMsFact(MSMAX) AS STRING
DIM SHARED aMsEx(MSMAX) AS STRING, aMsWords(MSMAX) AS STRING
DIM SHARED gSwAnswer AS STRING, gSwSources AS STRING, gSwChatN AS INTEGER, aSwChat(7) AS STRING
DIM SHARED gNfId AS LONG, gNfButtons AS LONG, gNfSeq AS LONG
DIM SHARED gNfX AS DOUBLE, gNfY AS DOUBLE, gNfVx AS DOUBLE, gNfVy AS DOUBLE

' ================================================================ small byte helpers
' two bytes, low byte first
FUNCTION U16$ (lV AS LONG)
    U16$ = CHR$(lV AND 255) + CHR$((lV \ 256) AND 255)
END FUNCTION

' a signed 16-bit number as two bytes
FUNCTION I16$ (lV AS LONG)
    I16$ = CHR$(lV AND 255) + CHR$((lV AND 65535) \ 256)
END FUNCTION

FUNCTION GetI16& (sSrc AS STRING, lPos AS LONG)
    DIM lV AS LONG
    lV = ASC(MID$(sSrc, lPos, 1)) + 256& * ASC(MID$(sSrc, lPos + 1, 1))
    IF lV >= 32768 THEN lV = lV - 65536
    GetI16& = lV
END FUNCTION

' a comma separated list of numbers; returns how many fit into dOut()
FUNCTION ParseNums% (sSrc AS STRING, dOut() AS DOUBLE)
    DIM iN AS INTEGER, lStart AS LONG, lComma AS LONG, iCap AS INTEGER
    iCap = UBOUND(dOut) + 1
    iN = 0
    IF LEN(sSrc) = 0 THEN
        ParseNums% = 0
        EXIT FUNCTION
    END IF
    lStart = 1
    DO
        IF iN < iCap THEN dOut(iN) = ValOf#(MID$(sSrc, lStart))
        iN = iN + 1
        lComma = INSTR(lStart, sSrc, ",")
        IF lComma = 0 THEN EXIT DO
        lStart = lComma + 1
    LOOP
    IF iN > iCap THEN iN = iCap
    ParseNums% = iN
END FUNCTION

' 32-bit FNV-1a of a byte string, as 8 hex digits
FUNCTION Fnv1a$ (sBytes AS STRING)
    DIM dH AS DOUBLE, dHigh AS DOUBLE, dX AS DOUBLE, dQ AS DOUBLE, lI AS LONG, iLow AS INTEGER, iK AS INTEGER, sHex AS STRING
    dH = 2166136261#
    FOR lI = 1 TO LEN(sBytes)
        dHigh = INT(dH / 256#)
        iLow = CINT(dH - dHigh * 256#)
        iLow = iLow XOR ASC(MID$(sBytes, lI, 1))
        dH = dHigh * 256# + iLow
        dX = (dH - INT(dH / 256#) * 256#) * 16777216# + dH * 403#
        dH = dX - INT(dX / 4294967296#) * 4294967296#
    NEXT lI
    sHex = ""
    FOR iK = 1 TO 8
        dQ = INT(dH / 16#)
        sHex = MID$("0123456789abcdef", CINT(dH - dQ * 16#) + 1, 1) + sHex
        dH = dQ
    NEXT iK
    Fnv1a$ = sHex
END FUNCTION

' write bytes to a file, replacing it
SUB WriteFileBytes (sName AS STRING, sData AS STRING)
    DIM iFile AS INTEGER
    iFile = FREEFILE
    OPEN sName FOR BINARY AS #iFile
    IF LOF(iFile) > 0 THEN
        CLOSE #iFile
        KILL sName
        iFile = FREEFILE
        OPEN sName FOR BINARY AS #iFile
    END IF
    IF LEN(sData) > 0 THEN PUT #iFile, , sData
    CLOSE #iFile
END SUB

' ================================================================ KV21 cache files
' "KV21", width, layers, length (16 bits each), then for each layer and position:
' key scale (float), key bytes, value scale (float), value bytes
FUNCTION KvExport$ (iLen AS INTEGER)
    DIM lSeq AS LONG, iLy AS INTEGER, iT AS INTEGER, iI AS INTEGER, lKv AS LONG, lOff AS LONG, sOut AS STRING
    IF gNetLoaded = 0 THEN
        KvExport$ = ""
        EXIT FUNCTION
    END IF
    lSeq = iLen
    IF lSeq < 0 THEN lSeq = 0
    IF lSeq > CTX THEN lSeq = CTX
    sOut = "KV21" + U16$(CLNG(gTD)) + U16$(CLNG(gTL)) + U16$(lSeq)
    FOR iLy = 0 TO gTL - 1
        lKv = CLNG(iLy) * CTX * gTD
        FOR iT = 0 TO lSeq - 1
            lOff = lKv + CLNG(iT) * gTD
            sOut = sOut + MKS$(aKs(iLy * CTX + iT))
            FOR iI = 0 TO gTD - 1
                sOut = sOut + CHR$(aKc(lOff + iI) AND 255)
            NEXT iI
            sOut = sOut + MKS$(aVs(iLy * CTX + iT))
            FOR iI = 0 TO gTD - 1
                sOut = sOut + CHR$(aVc(lOff + iI) AND 255)
            NEXT iI
        NEXT iT
    NEXT iLy
    KvExport$ = sOut
END FUNCTION

' puts a cache into the model and sets the prefix; returns the length, or -1 when the data does not fit this model
FUNCTION KvImport% (sBytes AS STRING)
    DIM lD AS LONG, lL AS LONG, lLen AS LONG, iLy AS INTEGER, iT AS INTEGER, iI AS INTEGER, lP AS LONG, lKv AS LONG, lOff AS LONG, iV AS INTEGER
    IF LEN(sBytes) < 10 THEN
        KvImport% = -1
        EXIT FUNCTION
    END IF
    IF LEFT$(sBytes, 4) <> "KV21" THEN
        KvImport% = -1
        EXIT FUNCTION
    END IF
    lD = ASC(MID$(sBytes, 5, 1)) + 256& * ASC(MID$(sBytes, 6, 1))
    lL = ASC(MID$(sBytes, 7, 1)) + 256& * ASC(MID$(sBytes, 8, 1))
    lLen = ASC(MID$(sBytes, 9, 1)) + 256& * ASC(MID$(sBytes, 10, 1))
    IF gNetLoaded = 0 THEN
        KvImport% = -1
        EXIT FUNCTION
    END IF
    IF lD <> gTD OR lL <> gTL OR lLen > CTX THEN
        KvImport% = -1
        EXIT FUNCTION
    END IF
    IF LEN(sBytes) < 10 + lL * lLen * 2 * (4 + lD) THEN
        KvImport% = -1
        EXIT FUNCTION
    END IF
    lP = 11
    FOR iLy = 0 TO gTL - 1
        lKv = CLNG(iLy) * CTX * gTD
        FOR iT = 0 TO lLen - 1
            lOff = lKv + CLNG(iT) * gTD
            aKs(iLy * CTX + iT) = CVS(MID$(sBytes, lP, 4))
            lP = lP + 4
            FOR iI = 0 TO gTD - 1
                iV = ASC(MID$(sBytes, lP, 1))
                IF iV > 127 THEN iV = iV - 256
                aKc(lOff + iI) = iV
                lP = lP + 1
            NEXT iI
            aVs(iLy * CTX + iT) = CVS(MID$(sBytes, lP, 4))
            lP = lP + 4
            FOR iI = 0 TO gTD - 1
                iV = ASC(MID$(sBytes, lP, 1))
                IF iV > 127 THEN iV = iV - 256
                aVc(lOff + iI) = iV
                lP = lP + 1
            NEXT iI
        NEXT iT
    NEXT iLy
    gKvPrefix = lLen
    KvImport% = lLen
END FUNCTION

' ================================================================ packets for slow links
FUNCTION Clamp16& (dV AS DOUBLE)
    IF dV > 32767# THEN
        Clamp16& = 32767
    ELSEIF dV < -32768# THEN
        Clamp16& = -32768
    ELSE
        Clamp16& = CLNG(dV)
    END IF
END FUNCTION

' 12 bytes: player, buttons, sequence (16 bits), then x and y in 1/16 units, vx and vy in 1/256 units (signed 16 bits)
FUNCTION NetPackFrame$ (lId AS LONG, dX AS DOUBLE, dY AS DOUBLE, dVx AS DOUBLE, dVy AS DOUBLE, lButtons AS LONG, lSeq AS LONG)
    NetPackFrame$ = CHR$(lId AND 255) + CHR$(lButtons AND 255) + U16$(lSeq AND 65535) + I16$(Clamp16&(INT(dX * 16# + 0.5#))) + I16$(Clamp16&(INT(dY * 16# + 0.5#))) + I16$(Clamp16&(INT(dVx * 256# + 0.5#))) + I16$(Clamp16&(INT(dVy * 256# + 0.5#)))
END FUNCTION

' the fields of a 12-byte frame go to gNfId, gNfButtons, gNfSeq, gNfX, gNfY, gNfVx, gNfVy
SUB NetUnpackFrame (sFrame AS STRING)
    gNfId = ASC(MID$(sFrame, 1, 1))
    gNfButtons = ASC(MID$(sFrame, 2, 1))
    gNfSeq = ASC(MID$(sFrame, 3, 1)) + 256& * ASC(MID$(sFrame, 4, 1))
    gNfX = GetI16&(sFrame, 5) / 16#
    gNfY = GetI16&(sFrame, 7) / 16#
    gNfVx = GetI16&(sFrame, 9) / 256#
    gNfVy = GetI16&(sFrame, 11) / 256#
END SUB

' weight count (16 bits), a float scale, then one signed byte per weight
FUNCTION NetPackBrain$ (dW() AS DOUBLE, iN AS INTEGER)
    DIM dBig AS DOUBLE, dScale AS DOUBLE, iI AS INTEGER, lQ AS LONG, sOut AS STRING, dA AS DOUBLE
    dBig = 0#
    FOR iI = 0 TO iN - 1
        dA = ABS(dW(iI))
        IF dA > dBig THEN dBig = dA
    NEXT iI
    IF dBig > 1D-08 THEN dScale = dBig / 127# ELSE dScale = 1#
    sOut = U16$(CLNG(iN)) + MKS$(CSNG(dScale))
    FOR iI = 0 TO iN - 1
        lQ = INT(dW(iI) / dScale + 0.5#)
        IF lQ > 127 THEN lQ = 127
        IF lQ < -127 THEN lQ = -127
        sOut = sOut + CHR$(lQ AND 255)
    NEXT iI
    NetPackBrain$ = sOut
END FUNCTION

' returns the weight count (or -1) and fills dOut()
FUNCTION NetUnpackBrain% (sBrain AS STRING, dOut() AS DOUBLE)
    DIM lN AS LONG, sngScale AS SINGLE, iI AS INTEGER, iQ AS INTEGER
    IF LEN(sBrain) < 6 THEN
        NetUnpackBrain% = -1
        EXIT FUNCTION
    END IF
    lN = ASC(MID$(sBrain, 1, 1)) + 256& * ASC(MID$(sBrain, 2, 1))
    sngScale = CVS(MID$(sBrain, 3, 4))
    IF LEN(sBrain) < 6 + lN OR lN > UBOUND(dOut) + 1 THEN
        NetUnpackBrain% = -1
        EXIT FUNCTION
    END IF
    FOR iI = 0 TO lN - 1
        iQ = ASC(MID$(sBrain, 7 + iI, 1))
        IF iQ > 127 THEN iQ = iQ - 256
        dOut(iI) = CDBL(CSNG(iQ * CDBL(sngScale)))
    NEXT iI
    NetUnpackBrain% = lN
END FUNCTION

' q times k with q squeezed to 8 bits: an integer multiply-add, as a weak CPU would do it
FUNCTION QuantDot# (dQ() AS DOUBLE, iK() AS INTEGER, iKoff AS INTEGER, dKScale AS DOUBLE, iLen AS INTEGER)
    DIM iI AS INTEGER, dBig AS DOUBLE, dA AS DOUBLE, dQScale AS DOUBLE, dInvQ AS DOUBLE, dAcc AS DOUBLE
    dBig = 0#
    FOR iI = 0 TO iLen - 1
        dA = ABS(dQ(iI))
        IF dA > dBig THEN dBig = dA
    NEXT iI
    IF dBig < 1D-20 THEN
        QuantDot# = 0#
        EXIT FUNCTION
    END IF
    dQScale = dBig / 127#
    dInvQ = 127# / dBig
    dAcc = 0#
    FOR iI = 0 TO iLen - 1
        dAcc = dAcc + FIX(dQ(iI) * dInvQ) * iK(iKoff + iI)
    NEXT iI
    QuantDot# = dAcc * dQScale * dKScale
END FUNCTION

' ================================================================ several shelves and the pre-answer check
SUB MsReset
    gMsShelfN = 0
    gMsN = 0
END SUB

' index of a shelf, made when it is new; -1 when all 8 are in use
FUNCTION MsShelf% (sName AS STRING)
    DIM iI AS INTEGER
    FOR iI = 0 TO gMsShelfN - 1
        IF aMsName(iI) = sName THEN
            MsShelf% = iI
            EXIT FUNCTION
        END IF
    NEXT iI
    IF gMsShelfN >= 8 THEN
        MsShelf% = -1
        EXIT FUNCTION
    END IF
    aMsName(gMsShelfN) = sName
    aMsCount(gMsShelfN) = 0
    gMsShelfN = gMsShelfN + 1
    MsShelf% = gMsShelfN - 1
END FUNCTION

SUB MsAdd (sShelf AS STRING, sTopic AS STRING, sFact AS STRING, sEx AS STRING)
    DIM iSh AS INTEGER, sT AS STRING, sF AS STRING, iId AS INTEGER
    iSh = MsShelf%(sShelf)
    IF iSh < 0 OR gMsN >= MSMAX THEN EXIT SUB
    sT = CleanAscii$(sTopic)
    sF = CleanAscii$(sFact)
    iId = gMsN
    aMsShelf(iId) = iSh
    aMsId(iId) = aMsCount(iSh)
    aMsCount(iSh) = aMsCount(iSh) + 1
    aMsTopic(iId) = sT
    aMsTopicLc(iId) = LCASE$(sT)
    aMsFact(iId) = sF
    aMsEx(iId) = CleanAscii$(sEx)
    aMsWords(iId) = WordSet$(sT, sF)
    gMsN = gMsN + 1
END SUB

' the best entry of one shelf for a question (highest score, then the lower id); -1 when nothing matches
FUNCTION MsSearch1% (iShelf AS INTEGER, sQuery AS STRING)
    DIM iI AS INTEGER, iJ AS INTEGER, iBest AS INTEGER, iScore AS INTEGER, iBestScore AS INTEGER, iWords AS INTEGER
    DIM aQ(255) AS STRING
    Tokenize sQuery
    iWords = gWordN
    FOR iI = 0 TO iWords - 1
        aQ(iI) = aWord(iI)
    NEXT iI
    iBest = -1
    iBestScore = 0
    FOR iI = 0 TO gMsN - 1
        IF aMsShelf(iI) = iShelf THEN
            iScore = 0
            FOR iJ = 0 TO iWords - 1
                IF INSTR(aMsWords(iI), " " + aQ(iJ) + " ") > 0 THEN
                    IF INSTR(aMsTopicLc(iI), aQ(iJ)) > 0 THEN iScore = iScore + 3 ELSE iScore = iScore + 1
                END IF
            NEXT iJ
            IF iScore > iBestScore THEN
                iBestScore = iScore
                iBest = iI
            END IF
        END IF
    NEXT iI
    MsSearch1% = iBest
END FUNCTION

' the draft with every [source tag] replaced by a space
FUNCTION StripTags$ (sDraft AS STRING)
    DIM lP AS LONG, lClose AS LONG, sOut AS STRING, lN AS LONG
    sOut = ""
    lN = LEN(sDraft)
    lP = 1
    DO WHILE lP <= lN
        IF MID$(sDraft, lP, 1) = "[" THEN
            lClose = INSTR(lP, sDraft, "]")
            IF lClose > 0 THEN
                sOut = sOut + " "
                lP = lClose + 1
            ELSE
                sOut = sOut + "["
                lP = lP + 1
            END IF
        ELSE
            sOut = sOut + MID$(sDraft, lP, 1)
            lP = lP + 1
        END IF
    LOOP
    StripTags$ = sOut
END FUNCTION

SUB SwChat (sLine AS STRING)
    IF gSwChatN < 8 THEN
        aSwChat(gSwChatN) = sLine
        gSwChatN = gSwChatN + 1
    END IF
END SUB

' Drafter and Checker: answers from the named shelves ("*" or "" for all, else a comma list), checks every number against
' the sources, and falls back to the plain facts when one is unbacked. Results in gSwAnswer, gSwSources, aSwChat().
SUB SwarmAsk (sQuestion AS STRING, sShelves AS STRING)
    DIM aNm(7) AS STRING, aHSrc(7) AS STRING, aHTopic(7) AS STRING, aHFact(7) AS STRING, aHEx(7) AS STRING
    DIM iNames AS INTEGER, iNh AS INTEGER, iI AS INTEGER, iSh AS INTEGER, iRec AS INTEGER, iOk AS INTEGER, iK AS INTEGER
    DIM lStart AS LONG, lComma AS LONG, lP AS LONG, lQ AS LONG
    DIM sDraft AS STRING, sHint AS STRING, sCombined AS STRING, sStripped AS STRING, sNum AS STRING, sCites AS STRING
    DIM aCite(7) AS STRING
    gSwChatN = 0
    iNames = 0
    IF LEN(sShelves) = 0 OR sShelves = "*" THEN
        FOR iI = 0 TO gMsShelfN - 1
            aNm(iNames) = aMsName(iI)
            iNames = iNames + 1
        NEXT iI
    ELSE
        lStart = 1
        DO
            lComma = INSTR(lStart, sShelves, ",")
            IF iNames < 8 THEN
                IF lComma = 0 THEN aNm(iNames) = MID$(sShelves, lStart) ELSE aNm(iNames) = MID$(sShelves, lStart, lComma - lStart)
                iNames = iNames + 1
            END IF
            IF lComma = 0 THEN EXIT DO
            lStart = lComma + 1
        LOOP
    END IF
    iNh = 0
    FOR iI = 0 TO iNames - 1
        iSh = -1
        FOR iK = 0 TO gMsShelfN - 1
            IF aMsName(iK) = aNm(iI) THEN iSh = iK
        NEXT iK
        IF iSh >= 0 THEN
            iRec = MsSearch1%(iSh, sQuestion)
            IF iRec >= 0 AND iNh < 8 THEN
                aHSrc(iNh) = aNm(iI) + "#" + IntStr$(CLNG(aMsId(iRec)))
                aHTopic(iNh) = aMsTopic(iRec)
                aHFact(iNh) = aMsFact(iRec)
                aHEx(iNh) = aMsEx(iRec)
                iNh = iNh + 1
            END IF
        END IF
    NEXT iI
    sDraft = ""
    FOR iI = 0 TO iNh - 1
        IF iI > 0 THEN sDraft = sDraft + CHR$(10)
        sDraft = sDraft + aHFact(iI)
        IF LEN(aHEx(iI)) > 0 THEN sDraft = sDraft + " (Example: " + aHEx(iI) + ")"
        sDraft = sDraft + " [" + aHSrc(iI) + "]"
    NEXT iI
    IF gNetLoaded THEN
        IF iNh > 0 THEN
            sHint = ThinkNet$(gPmMode + ":" + LEFT$(aHFact(0), 40) + "|" + LEFT$(sQuestion, 30), 0#)
            IF LEN(sHint) > 0 THEN sDraft = sDraft + CHR$(10) + "Tiny-Net Note: " + sHint
        END IF
    END IF
    CALL SwChat("Drafter: Proposed answer using " + IntStr$(CLNG(iNh)) + " source(s).")
    iOk = -1
    sCites = ""
    IF iNh = 0 THEN
        CALL SwChat("Checker: REJECTED - no matching source in persistent library.")
        iOk = 0
    ELSE
        sCombined = ""
        FOR iI = 0 TO iNh - 1
            sCombined = sCombined + " " + LCASE$(aHFact(iI)) + " " + LCASE$(aHEx(iI))
            aCite(iI) = "[" + aHSrc(iI) + ": " + aHTopic(iI) + "]"
            IF iI > 0 THEN sCites = sCites + " "
            sCites = sCites + aCite(iI)
        NEXT iI
        sStripped = StripTags$(sDraft)
        lP = 1
        DO WHILE lP <= LEN(sStripped) AND iOk
            IF IsDigit%(ASC(MID$(sStripped, lP, 1))) THEN
                lQ = lP
                DO WHILE lP <= LEN(sStripped)
                    IF IsDigit%(ASC(MID$(sStripped, lP, 1))) = 0 THEN EXIT DO
                    lP = lP + 1
                LOOP
                IF lP < LEN(sStripped) THEN
                    IF MID$(sStripped, lP, 1) = "." AND IsDigit%(ASC(MID$(sStripped, lP + 1, 1))) THEN
                        lP = lP + 1
                        DO WHILE lP <= LEN(sStripped)
                            IF IsDigit%(ASC(MID$(sStripped, lP, 1))) = 0 THEN EXIT DO
                            lP = lP + 1
                        LOOP
                    END IF
                END IF
                sNum = MID$(sStripped, lQ, lP - lQ)
                IF INSTR(sCombined, sNum) = 0 THEN
                    CALL SwChat("Checker: WARNING - number '" + sNum + "' not backed by source; clamping to source text.")
                    iOk = 0
                END IF
            ELSE
                lP = lP + 1
            END IF
        LOOP
        IF iOk THEN CALL SwChat("Checker: VERIFIED against " + sCites)
    END IF
    IF iOk THEN
        gSwAnswer = sDraft
    ELSE
        gSwAnswer = ""
        FOR iI = 0 TO iNh - 1
            IF iI > 0 THEN gSwAnswer = gSwAnswer + CHR$(10)
            gSwAnswer = gSwAnswer + aHFact(iI) + " [" + aHSrc(iI) + "]"
        NEXT iI
    END IF
    IF LEN(gSwAnswer) = 0 THEN gSwAnswer = "No verified source found across shelves. Try importing a .txt module for this topic."
    gSwSources = sCites
END SUB
