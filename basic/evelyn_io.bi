' evelyn_io.bi - file and text helpers shared by evelyn.bas and evelyn_proto.bas.

DIM SHARED gFileOk AS INTEGER

' the whole file as bytes; gFileOk is -1 when the file exists and has content.
' A name that does not exist is created empty by OPEN, so an empty result is removed again.
FUNCTION ReadFileText$ (sName AS STRING)
    DIM iFile AS INTEGER, lLen AS LONG, sData AS STRING
    gFileOk = 0
    iFile = FREEFILE
    OPEN sName FOR BINARY AS #iFile
    lLen = LOF(iFile)
    IF lLen = 0 THEN
        CLOSE #iFile
        KILL sName
        ReadFileText$ = ""
        EXIT FUNCTION
    END IF
    sData = INPUT$(lLen, #iFile)
    CLOSE #iFile
    gFileOk = -1
    ReadFileText$ = sData
END FUNCTION

SUB WriteFileText (sName AS STRING, sData AS STRING)
    DIM iFile AS INTEGER
    iFile = FREEFILE
    OPEN sName FOR OUTPUT AS #iFile
    PRINT #iFile, sData;
    CLOSE #iFile
END SUB

FUNCTION HexVal% (sCh AS STRING)
    DIM iV AS INTEGER
    iV = INSTR("0123456789abcdef", LCASE$(sCh)) - 1
    IF iV < 0 THEN iV = 0
    HexVal% = iV
END FUNCTION

FUNCTION IsHex% (sCh AS STRING)
    IF LEN(sCh) = 1 THEN
        IF INSTR("0123456789abcdefABCDEF", sCh) > 0 THEN
            IsHex% = -1
            EXIT FUNCTION
        END IF
    END IF
    IsHex% = 0
END FUNCTION

' bytes to lower-case hex
FUNCTION HexOf$ (sBytes AS STRING)
    DIM lI AS LONG, iC AS INTEGER, sOut AS STRING
    sOut = ""
    FOR lI = 1 TO LEN(sBytes)
        iC = ASC(MID$(sBytes, lI, 1))
        sOut = sOut + MID$("0123456789abcdef", (iC \ 16) + 1, 1) + MID$("0123456789abcdef", (iC AND 15) + 1, 1)
    NEXT lI
    HexOf$ = sOut
END FUNCTION

FUNCTION Unhex$ (sHex AS STRING)
    DIM lI AS LONG, sOut AS STRING
    sOut = ""
    lI = 1
    DO WHILE lI + 1 <= LEN(sHex)
        sOut = sOut + CHR$(HexVal%(MID$(sHex, lI, 1)) * 16 + HexVal%(MID$(sHex, lI + 1, 1)))
        lI = lI + 2
    LOOP
    Unhex$ = sOut
END FUNCTION

' text for a line: \\ \n and \xHH for anything outside printable ASCII
FUNCTION Esc$ (sSrc AS STRING)
    DIM lI AS LONG, iC AS INTEGER, sOut AS STRING
    sOut = ""
    FOR lI = 1 TO LEN(sSrc)
        iC = ASC(MID$(sSrc, lI, 1))
        IF iC = 92 THEN
            sOut = sOut + "\\"
        ELSEIF iC = 10 THEN
            sOut = sOut + "\n"
        ELSEIF iC = 9 THEN
            sOut = sOut + "\t"
        ELSEIF iC >= 32 AND iC <= 126 THEN
            sOut = sOut + CHR$(iC)
        ELSE
            sOut = sOut + "\x" + MID$("0123456789abcdef", (iC \ 16) + 1, 1) + MID$("0123456789abcdef", (iC AND 15) + 1, 1)
        END IF
    NEXT lI
    Esc$ = sOut
END FUNCTION

FUNCTION Unesc$ (sSrc AS STRING)
    DIM lI AS LONG, lN AS LONG, sC AS STRING, sD AS STRING, sOut AS STRING
    sOut = ""
    lN = LEN(sSrc)
    lI = 1
    DO WHILE lI <= lN
        sC = MID$(sSrc, lI, 1)
        IF sC = "\" AND lI < lN THEN
            sD = MID$(sSrc, lI + 1, 1)
            IF sD = "n" THEN
                sOut = sOut + CHR$(10)
                lI = lI + 2
            ELSEIF sD = "t" THEN
                sOut = sOut + CHR$(9)
                lI = lI + 2
            ELSEIF sD = "\" THEN
                sOut = sOut + "\"
                lI = lI + 2
            ELSEIF sD = "x" AND lI + 3 <= lN THEN
                IF IsHex%(MID$(sSrc, lI + 2, 1)) AND IsHex%(MID$(sSrc, lI + 3, 1)) THEN
                    sOut = sOut + CHR$(HexVal%(MID$(sSrc, lI + 2, 1)) * 16 + HexVal%(MID$(sSrc, lI + 3, 1)))
                    lI = lI + 4
                ELSE
                    sOut = sOut + sC
                    lI = lI + 1
                END IF
            ELSE
                sOut = sOut + sC
                lI = lI + 1
            END IF
        ELSE
            sOut = sOut + sC
            lI = lI + 1
        END IF
    LOOP
    Unesc$ = sOut
END FUNCTION

' prints each line of sText with a prefix and a space, lines escaped
SUB SayLines (sPrefix AS STRING, sText AS STRING)
    DIM lP AS LONG, lEol AS LONG, sLine AS STRING
    lP = 1
    DO
        lEol = INSTR(lP, sText, CHR$(10))
        IF lEol = 0 THEN
            sLine = MID$(sText, lP)
        ELSE
            sLine = MID$(sText, lP, lEol - lP)
        END IF
        PRINT sPrefix + " " + Esc$(sLine)
        IF lEol = 0 THEN EXIT DO
        lP = lEol + 1
    LOOP
END SUB
