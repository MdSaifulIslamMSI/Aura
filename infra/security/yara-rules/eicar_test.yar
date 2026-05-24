rule Aura_EICAR_Test_File
{
    meta:
        description = "Staging validation rule for the EICAR antivirus test string"
        scope = "staging-validation"
    strings:
        $eicar = "EICAR-STANDARD-ANTIVIRUS-TEST-FILE"
    condition:
        $eicar
}
